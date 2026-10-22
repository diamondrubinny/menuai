/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseMenu } from '../../../src/core/schema';
import { BRAND } from '../../../src/core/brand';
import type { SqlClient } from '../db/sql';
import { badRequest, conflict, HttpError, notFound } from '../errors';
import { requireRole } from '../auth/guard';
import { audit } from '../auth/service';
import { parseVersionHeader } from '../menus/routes';
import { publishedMenuCsp, renderPublishedMenu } from './render';
import type { PublishStore } from './store';

/** Published versions kept per menu (the live one is never pruned). Each can carry embedded images. */
export const MAX_VERSIONS = 50;

const idSchema = z.uuid();

export interface Publication {
  publicSlug: string;
  url: string;
  versionId: string;
  version: number;
  publishedAt: Date;
  publishedBy: string | null;
}

interface PublicationRow {
  public_slug: string;
  version_id: string;
  version: number;
  published_at: Date;
  published_by_name: string | null;
}

/** Public address of a published menu, next to the editor (`https://menu.example.com/m/<slug>`). */
export function publicUrl(publicBase: string, slug: string): string {
  return new URL(`m/${slug}`, publicBase.endsWith('/') ? publicBase : `${publicBase}/`).toString();
}

export async function loadPublication(db: SqlClient, menuId: string, publicBase: string): Promise<Publication | null> {
  const [row] = await db.query<PublicationRow>(
    `SELECT p.public_slug, p.version_id, v.version, p.published_at, u.name AS published_by_name
     FROM publications p
     JOIN menu_versions v ON v.id = p.version_id
     LEFT JOIN users u ON u.id = p.published_by
     WHERE p.menu_id = $1`,
    [menuId],
  );
  if (!row) return null;
  return {
    publicSlug: row.public_slug,
    url: publicUrl(publicBase, row.public_slug),
    versionId: row.version_id,
    version: row.version,
    publishedAt: row.published_at,
    publishedBy: row.published_by_name,
  };
}

function parseId(value: string): string {
  const id = idSchema.safeParse(value);
  if (!id.success) throw notFound();
  return id.data;
}

const NOT_FOUND_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Menu not found</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f4f2ee;color:#1c1915;text-align:center;padding:1rem}
small{color:#5f584e}a{color:inherit}</style></head>
<body><main><h1>Menu not found</h1><p>This menu is not published right now.</p>
<p lang="he" dir="rtl">התפריט אינו מפורסם כרגע.</p>
<p><small>Powered by <a href="${BRAND.repo}" rel="noopener">${BRAND.name}</a> · Open source</small></p></main></body></html>`;

const NOT_FOUND_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Friendly HTML 404 for guests (e.g. an old QR code), instead of the API's JSON error. */
export function sendMenuNotFound(reply: FastifyReply) {
  return reply
    .status(404)
    .type('text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('referrer-policy', 'no-referrer')
    .header('content-security-policy', NOT_FOUND_CSP)
    .send(NOT_FOUND_PAGE);
}

export async function publishRoutes(app: FastifyInstance, opts: { store: PublishStore }) {
  const { db, config } = app.deps;
  const { store } = opts;
  const viewer = requireRole('viewer');
  const editor = requireRole('editor');
  const owner = requireRole('owner');

  app.post(
    '/api/menus/:id/publish',
    { preHandler: editor, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const id = parseId((req.params as { id: string }).id);
      const expected = parseVersionHeader(req.headers['if-match']);
      if (expected === null) throw new HttpError(428, 'precondition_required');
      const body = z.object({ note: z.string().trim().max(200).default('') }).strict().safeParse(req.body ?? {});
      if (!body.success) throw badRequest();

      const [menu] = await db.query<{ slug: string; draft: unknown; draft_version: number }>(
        'SELECT slug, draft, draft_version FROM menus WHERE id = $1',
        [id],
      );
      if (!menu) throw notFound();
      // Publish exactly what the user is looking at — not a draft another device changed meanwhile.
      if (menu.draft_version !== expected) {
        return reply.status(409).send({ error: 'version_conflict', draftVersion: menu.draft_version });
      }
      const parsed = parseMenu(menu.draft);
      if (!parsed.ok) throw badRequest('invalid_menu');
      // Rendered from the stored, validated draft with our own exporter: no client-supplied HTML.
      const html = await renderPublishedMenu(parsed.menu);

      const result = await db.transaction(async (tx) => {
        // Lock the menu row: concurrent publishes of one menu queue up instead of racing on version numbers.
        const [locked] = await tx.query<{ draft_version: number }>('SELECT draft_version FROM menus WHERE id = $1 FOR UPDATE', [id]);
        if (!locked) throw notFound();
        if (locked.draft_version !== expected) throw conflict('version_conflict');
        const [version] = await tx.query<{ id: string; version: number }>(
          `INSERT INTO menu_versions (menu_id, version, data, note, created_by)
           VALUES ($1, COALESCE((SELECT max(version) FROM menu_versions WHERE menu_id = $1), 0) + 1, $2, $3, $4)
           RETURNING id, version`,
          [id, JSON.stringify(parsed.menu), body.data.note, req.user!.id],
        );
        // The public address is fixed at the first publish, so printed QR codes keep working.
        const [pub] = await tx.query<{ public_slug: string }>(
          `INSERT INTO publications (menu_id, public_slug, version_id, published_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (menu_id) DO UPDATE SET version_id = EXCLUDED.version_id, published_by = EXCLUDED.published_by, published_at = now()
           RETURNING public_slug`,
          [id, menu.slug, version!.id, req.user!.id],
        );
        await tx.query(
          `DELETE FROM menu_versions WHERE menu_id = $1 AND id <> $2 AND id NOT IN (
             SELECT id FROM menu_versions WHERE menu_id = $1 ORDER BY version DESC LIMIT $3)`,
          [id, version!.id, MAX_VERSIONS],
        );
        await audit(tx, { userId: req.user!.id, action: 'menu.publish', targetType: 'menu', targetId: id, meta: { version: version!.version } });
        // Last step inside the transaction: if writing fails, the database is rolled back too.
        await store.write(pub!.public_slug, html);
        return version!;
      });

      const publication = await loadPublication(db, id, config.PUBLIC_URL);
      return { publication, version: result.version };
    },
  );

  app.get('/api/menus/:id/versions', { preHandler: viewer }, async (req) => {
    const id = parseId((req.params as { id: string }).id);
    const [exists] = await db.query('SELECT 1 FROM menus WHERE id = $1', [id]);
    if (!exists) throw notFound();
    const versions = await db.query<{ id: string; version: number; note: string; created_at: Date; created_by_name: string | null }>(
      `SELECT v.id, v.version, v.note, v.created_at, u.name AS created_by_name
       FROM menu_versions v LEFT JOIN users u ON u.id = v.created_by
       WHERE v.menu_id = $1 ORDER BY v.version DESC`,
      [id],
    );
    const publication = await loadPublication(db, id, config.PUBLIC_URL);
    return {
      publication,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        note: v.note,
        createdAt: v.created_at,
        createdBy: v.created_by_name,
        live: publication?.versionId === v.id,
      })),
    };
  });

  app.post('/api/menus/:id/restore/:versionId', { preHandler: owner }, async (req) => {
    const params = req.params as { id: string; versionId: string };
    const id = parseId(params.id);
    const versionId = parseId(params.versionId);
    const [version] = await db.query<{ data: unknown; version: number }>(
      'SELECT data, version FROM menu_versions WHERE id = $1 AND menu_id = $2',
      [versionId, id],
    );
    if (!version) throw notFound();
    const parsed = parseMenu(version.data);
    if (!parsed.ok) throw badRequest('invalid_menu');
    // Restores into the draft (not live): the owner can review, then publish again.
    const [row] = await db.query<{ id: string; slug: string; draft_version: number; updated_at: Date }>(
      `UPDATE menus SET draft = $2, draft_version = draft_version + 1, updated_by = $3, updated_at = now()
       WHERE id = $1 RETURNING id, slug, draft_version, updated_at`,
      [id, JSON.stringify(parsed.menu), req.user!.id],
    );
    if (!row) throw notFound();
    await audit(db, { userId: req.user!.id, action: 'menu.restore', targetType: 'menu', targetId: id, meta: { version: version.version } });
    return {
      menu: { id: row.id, slug: row.slug, draftVersion: row.draft_version, updatedAt: row.updated_at, updatedBy: req.user!.name, draft: parsed.menu },
    };
  });

  app.post('/api/menus/:id/unpublish', { preHandler: owner }, async (req, reply) => {
    const id = parseId((req.params as { id: string }).id);
    await db.transaction(async (tx) => {
      const [pub] = await tx.query<{ public_slug: string }>('DELETE FROM publications WHERE menu_id = $1 RETURNING public_slug', [id]);
      if (!pub) throw notFound();
      await audit(tx, { userId: req.user!.id, action: 'menu.unpublish', targetType: 'menu', targetId: id });
      await store.remove(pub.public_slug);
    });
    return reply.status(204).send();
  });

  // Public, read-only: the published file straight from disk. No session, no database.
  const servePublished = async (req: FastifyRequest, reply: FastifyReply) => {
    const slug = (req.params as { slug: string }).slug;
    const file = await store.read(slug);
    if (!file) return sendMenuNotFound(reply);
    reply
      .header('content-security-policy', await publishedMenuCsp())
      .header('referrer-policy', 'no-referrer')
      .header('cross-origin-resource-policy', 'same-origin')
      .header('etag', file.etag)
      // Always revalidate (a tiny 304 when unchanged): a new publish or unpublish shows up immediately.
      .header('cache-control', 'no-cache')
      .type('text/html; charset=utf-8');
    if (req.headers['if-none-match'] === file.etag) return reply.status(304).send();
    return reply.send(file.html);
  };
  const publicRoute = { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } }, logLevel: 'warn' as const };
  app.get('/m/:slug', publicRoute, servePublished);
  app.get('/m/:slug/', publicRoute, servePublished);
}
