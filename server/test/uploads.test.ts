/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer, type Server } from 'node:net';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ORIGIN, testApp, testDb } from './helpers';
import { issueLoginToken, redeemLoginToken } from '../src/auth/service';
import type { SqlClient } from '../src/db/sql';
import type { Config } from '../src/config';
import { loadConfig } from '../src/config';
import { clamdScanner, ScannerUnavailableError, type Scanner } from '../src/uploads/clamd';
import { collectOrphanUploads } from '../src/uploads/routes';
import { createMediaStore } from '../src/uploads/store';
import { sniffImage } from '../src/uploads/images';
import { createSampleMenu } from '../../src/core/sample';
import { parseMenu } from '../../src/core/schema';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

let app: FastifyInstance;
let db: SqlClient;
let config: Config;
const cookies: Record<'owner' | 'editor' | 'viewer', string> = { owner: '', editor: '', viewer: '' };
type As = keyof typeof cookies | 'anon';

/** Flags any upload containing the EICAR marker, like clamd with its test signature. */
const fakeScanner: Scanner = {
  scan: async (data) => (data.includes('EICAR-STANDARD') ? { clean: false, signature: 'Eicar-Test-Signature' } : { clean: true }),
};

async function setup(scanner: Scanner | null = fakeScanner, extra: Record<string, string> = {}) {
  db = await testDb();
  ({ app, config } = await testApp({ db, scanner, config: extra }));
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    const [row] = await db.query<{ id: string }>('INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id', [`${role}@example.com`, role, role]);
    const session = await redeemLoginToken(db, (await issueLoginToken(db, row!.id, 15))!, 'test');
    cookies[role] = `menuai_session=${session!.sessionToken}`;
  }
}
afterEach(() => app?.close());

function upload(body: Buffer, type: string, as: As = 'editor', origin = ORIGIN) {
  return app.inject({
    method: 'POST',
    url: '/api/uploads',
    payload: body,
    headers: { 'content-type': type, origin, ...(as === 'anon' ? {} : { cookie: cookies[as] }) },
  });
}

const png = (w = 64, h = 48) => sharp({ create: { width: w, height: h, channels: 3, background: '#c08040' } }).png().toBuffer();
const files = (sub: string) => (existsSync(path.join(config.UPLOAD_DIR, sub)) ? readdirSync(path.join(config.UPLOAD_DIR, sub)) : []);

describe('uploads: accepted images', () => {
  it('scans, re-encodes to WebP and serves the image at an unguessable public URL', async () => {
    await setup();
    const res = await upload(await png(), 'image/png');
    expect(res.statusCode).toBe(201);
    const { upload: u } = res.json();
    expect(u.url).toMatch(/^\/media\/[0-9a-f-]{36}\.webp$/);
    expect(u).toMatchObject({ width: 64, height: 48 });
    expect(files('quarantine')).toEqual([]); // the original never stays on disk
    expect(files('public')).toEqual([`${u.id}.webp`]);

    const served = await app.inject({ method: 'GET', url: u.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(String(served.headers['content-security-policy'])).toContain("default-src 'none'");
    expect(served.headers['set-cookie']).toBeUndefined();
    expect(sniffImage(served.rawPayload)).toBe('image/webp');

    const [row] = await db.query<{ status: string; mime: string; scan_result: string; width: number }>('SELECT status, mime, scan_result, width FROM uploads');
    expect(row).toEqual({ status: 'clean', mime: 'image/webp', scan_result: 'OK', width: 64 });
    // A menu can now reference it (the shared schema accepts /media/ URLs).
    const menu = { ...createSampleMenu(), hero: { src: u.url, alt: {} } };
    expect(parseMenu(menu).ok).toBe(true);
  });

  it('strips metadata (EXIF/GPS) and downsizes large photos', async () => {
    await setup();
    const photo = await sharp({ create: { width: 3200, height: 2000, channels: 3, background: '#336699' } })
      .jpeg()
      .withExif({ IFD0: { ImageDescription: 'SECRET-LOCATION-32.08N', Copyright: 'someone' } })
      .toBuffer();
    expect(photo.includes('SECRET-LOCATION')).toBe(true);
    const res = await upload(photo, 'image/jpeg');
    expect(res.statusCode).toBe(201);
    expect(res.json().upload).toMatchObject({ width: 1600, height: 1000 });
    const served = (await app.inject({ method: 'GET', url: res.json().upload.url })).rawPayload;
    expect(served.includes('SECRET-LOCATION')).toBe(false);
    expect((await sharp(served).metadata()).exif).toBeUndefined();
  });

  it('drops data appended to an image (polyglot payload)', async () => {
    await setup();
    const sneaky = Buffer.concat([await png(), Buffer.from('<script>alert(1)</script>')]);
    const res = await upload(sneaky, 'image/png');
    expect(res.statusCode).toBe(201);
    const served = (await app.inject({ method: 'GET', url: res.json().upload.url })).rawPayload;
    expect(served.includes('<script>')).toBe(false);
  });
});

describe('uploads: rejected files', () => {
  it('rejects files whose real type does not match (SVG/HTML renamed to .png)', async () => {
    await setup();
    for (const [body, type] of [
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'image/png'],
      [Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg'],
      [await png(), 'image/jpeg'],
      [await png(), 'image/svg+xml'],
      [await png(), 'text/html'],
    ] as const) {
      const res = await upload(body, type);
      expect([415, 400], type).toContain(res.statusCode);
    }
    expect(await db.query('SELECT 1 FROM uploads')).toHaveLength(0);
  });

  it('quarantines and rejects an infected file, audits it, and keeps nothing on disk', async () => {
    await setup();
    const infected = Buffer.concat([await png(), Buffer.from(EICAR)]);
    const res = await upload(infected, 'image/png');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'rejected' });
    expect(files('quarantine')).toEqual([]);
    expect(files('public')).toEqual([]);
    const [row] = await db.query<{ status: string; scan_result: string }>('SELECT status, scan_result FROM uploads');
    expect(row).toEqual({ status: 'rejected', scan_result: 'Eicar-Test-Signature' });
    const [log] = await db.query<{ action: string; meta: { signature: string } }>("SELECT action, meta FROM audit_log WHERE action = 'upload.rejected'");
    expect(log!.meta.signature).toBe('Eicar-Test-Signature');
  });

  it('refuses the upload when the scanner is down (never accepts unscanned files)', async () => {
    await setup({ scan: async () => { throw new ScannerUnavailableError('down'); } });
    const res = await upload(await png(), 'image/png');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'scanner_unavailable' });
    expect(files('public')).toEqual([]);
    expect(files('quarantine')).toEqual([]);
  });

  it('disables uploads entirely without a configured scanner', async () => {
    await setup(null);
    const res = await upload(await png(), 'image/png');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'uploads_unavailable' });
  });

  it('rejects corrupt images that pass the magic-byte check', async () => {
    await setup();
    const broken = Buffer.concat([(await png()).subarray(0, 40), Buffer.alloc(200)]);
    const res = await upload(broken, 'image/png');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'invalid_image' });
  });

  it('refuses pixel bombs', async () => {
    await setup();
    // 9000×9000 = 81 MP of a single colour compresses to a tiny PNG.
    const bomb = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const res = await upload(bomb, 'image/png');
    expect(res.statusCode).toBe(422);
  });

  it('enforces size, quota, roles and origin', async () => {
    await setup(fakeScanner, { UPLOAD_QUOTA_MB: '1' });
    expect((await upload(await png(), 'image/png', 'viewer')).statusCode).toBe(403);
    expect((await upload(await png(), 'image/png', 'anon')).statusCode).toBe(401);
    expect((await upload(await png(), 'image/png', 'editor', 'https://evil.example')).statusCode).toBe(403);
    expect((await upload(Buffer.alloc(9 * 1024 * 1024), 'image/png')).statusCode).toBe(413);
    await db.query(
      "INSERT INTO uploads (status, mime, bytes, sha256, storage_key) VALUES ('clean', 'image/webp', 1048570, repeat('a', 64), 'x')",
    );
    const full = await upload(await png(), 'image/png');
    expect(full.statusCode).toBe(507);
    expect(full.json()).toEqual({ error: 'storage_full' });
  });
});

describe('media serving', () => {
  it('returns 404 for unknown, malformed or traversal paths', async () => {
    await setup();
    for (const p of [`/media/${crypto.randomUUID()}.webp`, '/media/x.webp', '/media/..%2F..%2Fetc%2Fpasswd', '/media/%2e%2e%2fquarantine']) {
      expect((await app.inject({ method: 'GET', url: p })).statusCode, p).toBe(404);
    }
  });
});

describe('orphan cleanup', () => {
  it('removes old images no draft or version uses, keeps used and recent ones', async () => {
    await setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await upload(await png(), 'image/png')).json().upload.id);
    const [used, inVersion, orphan] = ids as [string, string, string];
    const menu = { ...createSampleMenu(), hero: { src: `/media/${used}.webp`, alt: {} } };
    const created = (await app.inject({ method: 'POST', url: '/api/menus', payload: { menu }, headers: { origin: ORIGIN, cookie: cookies.editor } })).json().menu;
    await db.query("INSERT INTO menu_versions (menu_id, version, data) VALUES ($1, 1, $2)", [created.id, JSON.stringify({ ...menu, logo: { src: `/media/${inVersion}.webp`, alt: {} } })]);

    expect(await collectOrphanUploads(db, createMediaStore(config.UPLOAD_DIR))).toBe(0); // all recent
    await db.query("UPDATE uploads SET created_at = now() - interval '2 days'");
    expect(await collectOrphanUploads(db, createMediaStore(config.UPLOAD_DIR))).toBe(1);
    expect(files('public').sort()).toEqual([`${used}.webp`, `${inVersion}.webp`].sort());
    expect((await app.inject({ method: 'GET', url: `/media/${orphan}.webp` })).statusCode).toBe(404);
  });
});

describe('config', () => {
  it('refuses unscanned uploads in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x/y', PUBLIC_URL: 'https://menu.example.com', UPLOADS_ALLOW_UNSCANNED: 'true' }),
    ).toThrow(/UPLOADS_ALLOW_UNSCANNED/);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x/y', PUBLIC_URL: 'https://m.example.com', CLAMAV_URL: 'http://clamav:3310' })).toThrow(/CLAMAV_URL/);
  });
});

describe('clamd client (protocol)', () => {
  let server: Server;
  let port = 0;
  let received: Buffer[] = [];
  let reply = 'stream: OK\0';
  const sockets = new Set<import('node:net').Socket>();

  beforeAll(async () => {
    server = createServer({ allowHalfOpen: true }, (sock) => {
      sockets.add(sock);
      const parts: Buffer[] = [];
      sock.on('data', (d: Buffer) => {
        parts.push(d);
        const all = Buffer.concat(parts);
        // Wait for the zero-length terminator chunk, then answer like clamd.
        if (all.length >= 14 && all.subarray(-4).equals(Buffer.alloc(4))) {
          received = [all];
          if (reply === 'HANG') return;
          sock.end(reply);
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => {
    for (const s of sockets) s.destroy();
    return new Promise<void>((r) => server.close(() => r()));
  });

  it('streams with zINSTREAM and length-prefixed chunks', async () => {
    reply = 'stream: OK\0';
    const data = Buffer.alloc(150 * 1024, 7);
    expect(await clamdScanner(`tcp://127.0.0.1:${port}`).scan(data)).toEqual({ clean: true });
    const wire = received[0]!;
    expect(wire.subarray(0, 10).toString()).toBe('zINSTREAM\0');
    expect(wire.readUInt32BE(10)).toBe(64 * 1024);
    expect(wire.length).toBe(10 + 3 * 4 + data.length + 4);
  });

  it('reports infections with the signature name', async () => {
    reply = 'stream: Win.Test.EICAR_HDB-1 FOUND\0';
    expect(await clamdScanner(`tcp://127.0.0.1:${port}`).scan(Buffer.from('x'))).toEqual({ clean: false, signature: 'Win.Test.EICAR_HDB-1' });
  });

  it('treats errors, garbage, timeouts and refused connections as "unavailable"', async () => {
    reply = 'INSTREAM size limit exceeded. ERROR\0';
    await expect(clamdScanner(`tcp://127.0.0.1:${port}`).scan(Buffer.from('x'))).rejects.toBeInstanceOf(ScannerUnavailableError);
    reply = 'HANG';
    await expect(clamdScanner(`tcp://127.0.0.1:${port}`, 200).scan(Buffer.from('x'))).rejects.toThrow(/timeout/);
    await expect(clamdScanner('tcp://127.0.0.1:1').scan(Buffer.from('x'))).rejects.toBeInstanceOf(ScannerUnavailableError);
  });
});

// Runs only with a real clamd (e.g. CLAMAV_TEST_URL=tcp://127.0.0.1:3310).
const realClamd = process.env.CLAMAV_TEST_URL;
describe.skipIf(!realClamd)('real clamd', () => {
  it('detects the EICAR test file and passes a clean image', async () => {
    const scanner = clamdScanner(realClamd ?? '');
    const verdict = await scanner.scan(Buffer.from(EICAR));
    expect(verdict.clean).toBe(false);
    expect(await scanner.scan(await png())).toEqual({ clean: true });
  });

  it('end to end: a clean upload passes the real scanner', async () => {
    // (The infected path is covered above at the scanner level: EICAR is not an image, so it would be
    // refused by the type check before reaching the scanner.)
    await setup(clamdScanner(realClamd ?? ''));
    expect((await upload(await png(), 'image/png')).statusCode).toBe(201);
  });
});

