/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { HttpError } from '../errors';
import { requireRole } from '../auth/guard';
import { audit } from '../auth/service';
import { ScannerUnavailableError, type Scanner } from './clamd';
import { ImageDecodeError, MAX_UPLOAD_BYTES, processImage, sniffImage, UPLOAD_TYPES, type UploadType } from './images';
import type { MediaStore } from './store';
export { collectOrphanUploads } from './gc';

export const mediaUrl = (id: string) => `/media/${id}.webp`;

const MEDIA_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/;

export async function uploadRoutes(app: FastifyInstance, opts: { media: MediaStore; scanner: Scanner | null }) {
  const { db, config } = app.deps;
  const { media, scanner } = opts;
  const editor = requireRole('editor');
  const quotaBytes = config.UPLOAD_QUOTA_MB * 1024 * 1024;

  // The body is the image itself: no multipart parsing, no client file names.
  app.addContentTypeParser([...UPLOAD_TYPES], { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) => done(null, body));

  app.post(
    '/api/uploads',
    { preHandler: editor, bodyLimit: MAX_UPLOAD_BYTES, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!scanner) throw new HttpError(503, 'uploads_unavailable');
      const declared = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase() as UploadType;
      const data = req.body;
      if (!Buffer.isBuffer(data) || !(UPLOAD_TYPES as readonly string[]).includes(declared)) throw new HttpError(415, 'unsupported_type');
      // The real type must match: an SVG/HTML file renamed to .png never gets further.
      if (sniffImage(data) !== declared) throw new HttpError(415, 'unsupported_type');

      const [used] = await db.query<{ n: string }>("SELECT COALESCE(sum(bytes), 0) AS n FROM uploads WHERE status = 'clean'");
      if (Number(used?.n ?? 0) + data.length > quotaBytes) throw new HttpError(507, 'storage_full');

      const id = randomUUID();
      const sha = createHash('sha256').update(data).digest('hex');
      await media.quarantine(id, data);
      await db.query(
        `INSERT INTO uploads (id, status, mime, bytes, sha256, storage_key, created_by) VALUES ($1, 'quarantine', $2, $3, $4, $5, $6)`,
        [id, declared, data.length, sha, `quarantine/${id}`, req.user!.id],
      );

      let result;
      try {
        let verdict;
        try {
          verdict = await scanner.scan(data);
        } catch (err) {
          if (err instanceof ScannerUnavailableError) {
            req.log.error({ err: err.message }, 'virus scanner unavailable: upload refused');
            await db.query("UPDATE uploads SET status = 'rejected', scan_result = 'scanner unavailable', scanned_at = now() WHERE id = $1", [id]);
            throw new HttpError(503, 'scanner_unavailable');
          }
          throw err;
        }
        if (!verdict.clean) {
          await db.query("UPDATE uploads SET status = 'rejected', scan_result = $2, scanned_at = now() WHERE id = $1", [id, verdict.signature]);
          await audit(db, { userId: req.user!.id, action: 'upload.rejected', targetType: 'upload', targetId: id, meta: { signature: verdict.signature } });
          req.log.warn({ uploadId: id, signature: verdict.signature }, 'infected upload rejected');
          throw new HttpError(422, 'rejected');
        }

        let processed;
        try {
          processed = await processImage(data);
        } catch (err) {
          if (!(err instanceof ImageDecodeError)) throw err;
          await db.query("UPDATE uploads SET status = 'rejected', scan_result = 'not a valid image', scanned_at = now() WHERE id = $1", [id]);
          throw new HttpError(422, 'invalid_image');
        }
        await media.publish(id, processed.webp);
        await db.query(
          `UPDATE uploads SET status = 'clean', mime = 'image/webp', bytes = $2, sha256 = $3, storage_key = $4,
             width = $5, height = $6, scan_result = 'OK', scanned_at = now()
           WHERE id = $1`,
          [id, processed.webp.length, createHash('sha256').update(processed.webp).digest('hex'), `public/${id}.webp`, processed.width, processed.height],
        );
        result = { id, url: mediaUrl(id), width: processed.width, height: processed.height, bytes: processed.webp.length };
      } finally {
        // Whatever happened, the original never stays on disk.
        await media.dropQuarantine(id);
      }
      return reply.status(201).send({ upload: result });
    },
  );

  // Public: published menus show these images to guests. Ids are random UUIDs; there is no listing.
  app.get('/media/:file', { config: { rateLimit: { max: 2400, timeWindow: '1 minute' } }, logLevel: 'warn' }, async (req, reply) => {
    const match = MEDIA_FILE_RE.exec((req.params as { file: string }).file);
    const data = match ? await media.read(match[1]!) : null;
    reply
      .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
      .header('cross-origin-resource-policy', 'same-origin');
    if (!data) return reply.status(404).header('cache-control', 'no-store').send({ error: 'not_found' });
    // A new image always gets a new id, so the file never changes: cache it for a year.
    return reply.type('image/webp').header('cache-control', 'public, max-age=31536000, immutable').send(data);
  });
}
