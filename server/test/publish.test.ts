/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ORIGIN, testApp, testDb } from './helpers';
import { issueLoginToken, redeemLoginToken } from '../src/auth/service';
import type { SqlClient } from '../src/db/sql';
import type { Config } from '../src/config';
import { createSampleMenu } from '../../src/core/sample';
import { MAX_VERSIONS, publicUrl } from '../src/publish/routes';
import { createFileStore } from '../src/publish/store';
import { fontPath } from '../src/publish/render';
import { FONT_FILES } from '../../src/core/fontFiles.generated';
import type { Menu } from '../../src/core/schema';

let app: FastifyInstance;
let db: SqlClient;
let config: Config;
const cookies: Record<'owner' | 'editor' | 'viewer', string> = { owner: '', editor: '', viewer: '' };
type As = keyof typeof cookies | 'anon';

async function seed(role: keyof typeof cookies) {
  const [row] = await db.query<{ id: string }>(
    'INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id',
    [`${role}@example.com`, role.toUpperCase(), role],
  );
  const session = await redeemLoginToken(db, (await issueLoginToken(db, row!.id, 15))!, 'test');
  cookies[role] = `menuai_session=${session!.sessionToken}`;
}

function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, as: As, opts: { payload?: unknown; headers?: Record<string, string> } = {}) {
  return app.inject({
    method,
    url,
    payload: opts.payload as object,
    headers: { origin: ORIGIN, ...(as === 'anon' ? {} : { cookie: cookies[as] }), ...opts.headers },
  });
}

async function createMenu(menu: Menu = { ...createSampleMenu(), title: { he: 'לומייר', en: 'Lumière' } }) {
  const res = await call('POST', '/api/menus', 'editor', { payload: { menu } });
  expect(res.statusCode).toBe(201);
  return res.json().menu as { id: string; slug: string; draftVersion: number; draft: Menu };
}

const publish = (id: string, version: number, as: As = 'editor', note?: string) =>
  call('POST', `/api/menus/${id}/publish`, as, { payload: note === undefined ? {} : { note }, headers: { 'if-match': `"${version}"` } });

async function save(id: string, version: number, draft: Menu) {
  const res = await call('PUT', `/api/menus/${id}`, 'editor', { payload: draft, headers: { 'if-match': `"${version}"` } });
  expect(res.statusCode).toBe(200);
  return res.json().menu.draftVersion as number;
}

const files = () => readdirSync(config.PUBLISH_DIR);

beforeEach(async () => {
  db = await testDb();
  ({ app, config } = await testApp({ db }));
  for (const role of ['owner', 'editor', 'viewer'] as const) await seed(role);
});
afterEach(() => app.close());

describe('publishing', () => {
  it('renders the stored draft on the server and serves it at a fixed public address', async () => {
    const menu = await createMenu();
    const res = await publish(menu.id, 1, 'editor', 'Opening night');
    expect(res.statusCode).toBe(200);
    const { publication, version } = res.json();
    expect(version).toBe(1);
    expect(publication).toMatchObject({ publicSlug: 'lumiere', url: 'http://localhost:5173/m/lumiere', version: 1, publishedBy: 'EDITOR' });
    expect(files()).toEqual(['lumiere.html']);

    const page = await call('GET', '/m/lumiere', 'anon');
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.headers['cache-control']).toBe('no-cache');
    const again = await call('GET', '/m/lumiere', 'anon', { headers: { 'if-none-match': String(page.headers.etag) } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    expect(page.headers['set-cookie']).toBeUndefined();
    const csp = String(page.headers['content-security-policy']);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' data: https:"); // uploaded images (/media/…) on the same origin
    expect(csp).not.toContain('connect-src'); // falls back to 'none': no calls to the API from a published page
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.body).toContain('<title>לומייר</title>');
    expect(page.body).toContain('data-ma-credit');
    // Fonts are embedded from the bundled files, so the page makes no other requests.
    expect(page.body).toMatch(/src:url\(data:font\/woff2;base64,[A-Za-z0-9+/]{100}/);
    // The script hash in the header matches the one in the page's own meta CSP.
    const metaHash = /script-src 'sha256-([^']+)'/.exec(page.body)?.[1];
    expect(csp).toContain(`sha256-${metaHash}`);
    expect((await call('GET', '/m/lumiere/', 'anon')).statusCode).toBe(200);
  });

  it('updates the same address on every publish and keeps the address after the menu slug is reused', async () => {
    const menu = await createMenu();
    await publish(menu.id, 1);
    const v2 = await save(menu.id, 1, { ...menu.draft, title: { he: 'לומייר החדש' } });
    const res = await publish(menu.id, v2);
    expect(res.json().publication).toMatchObject({ publicSlug: 'lumiere', version: 2 });
    expect((await call('GET', '/m/lumiere', 'anon')).body).toContain('<title>לומייר החדש</title>');
    expect(files()).toEqual(['lumiere.html']); // atomic replace, no temp files left behind
  });

  it('refuses to publish a draft that changed since the user last saw it', async () => {
    const menu = await createMenu();
    await save(menu.id, 1, { ...menu.draft, title: { he: 'מכשיר אחר' } });
    const stale = await publish(menu.id, 1);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'version_conflict', draftVersion: 2 });
    expect(files()).toEqual([]);
    const missing = await call('POST', `/api/menus/${menu.id}/publish`, 'editor', { payload: {} });
    expect(missing.statusCode).toBe(428);
  });

  it('enforces roles: editors publish, viewers cannot, guests need no session', async () => {
    const menu = await createMenu();
    expect((await publish(menu.id, 1, 'viewer')).statusCode).toBe(403);
    expect((await publish(menu.id, 1, 'anon')).statusCode).toBe(401);
    expect((await publish(menu.id, 1, 'editor')).statusCode).toBe(200);
    expect((await call('POST', `/api/menus/${menu.id}/unpublish`, 'editor')).statusCode).toBe(403);
    expect((await call('GET', `/api/menus/${menu.id}/versions`, 'anon')).statusCode).toBe(401);
    expect((await call('GET', `/api/menus/${menu.id}/versions`, 'viewer')).statusCode).toBe(200);
  });

  it('validates the note and rejects publishing from another origin', async () => {
    const menu = await createMenu();
    expect((await publish(menu.id, 1, 'editor', 'x'.repeat(201))).statusCode).toBe(400);
    const csrf = await call('POST', `/api/menus/${menu.id}/publish`, 'editor', { payload: {}, headers: { 'if-match': '"1"', origin: 'https://evil.example' } });
    expect(csrf.statusCode).toBe(403);
    expect(files()).toEqual([]);
  });

  it('rolls back when the file cannot be written', async () => {
    db = await testDb();
    await app.close();
    const failing = { ...createFileStore('/nonexistent'), write: async () => { throw new Error('disk full'); } };
    ({ app, config } = await testApp({ db, publishStore: failing }));
    for (const role of ['owner', 'editor', 'viewer'] as const) await seed(role);
    const menu = await createMenu();
    expect((await publish(menu.id, 1)).statusCode).toBe(500);
    expect(await db.query('SELECT 1 FROM menu_versions')).toHaveLength(0);
    expect(await db.query('SELECT 1 FROM publications')).toHaveLength(0);
    expect(await db.query("SELECT 1 FROM audit_log WHERE action = 'menu.publish'")).toHaveLength(0);
  });

  it('lists the menu as live in the menu list', async () => {
    const menu = await createMenu();
    expect((await call('GET', '/api/menus', 'viewer')).json().menus[0].publicUrl).toBeNull();
    await publish(menu.id, 1);
    expect((await call('GET', '/api/menus', 'viewer')).json().menus[0].publicUrl).toBe('http://localhost:5173/m/lumiere');
  });
});

describe('public pages', () => {
  it('shows a friendly 404 for unknown or malformed slugs without touching the disk outside the folder', async () => {
    for (const slug of ['nope', '..%2F..%2Fetc%2Fpasswd', 'UPPER', '-x', 'a/b']) {
      const res = await call('GET', `/m/${slug}`, 'anon');
      expect(res.statusCode, slug).toBe(404);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('Menu not found');
      expect(res.body).toContain('Powered by');
      expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'");
    }
    // Dot segments are normalized away before routing: they never reach the menu route.
    expect((await call('GET', '/m/%2e%2e', 'anon')).statusCode).toBe(404);
  });

  it('does not log guest visits', async () => {
    const logs: string[] = [];
    await app.close();
    ({ app, config } = await testApp({ db, logs }));
    await call('GET', '/m/lumiere', 'anon');
    expect(logs.join('\n')).not.toContain('/m/lumiere');
  });
});

describe('versions, restore and unpublish', () => {
  it('lists versions with the live one marked, newest first', async () => {
    const menu = await createMenu();
    await publish(menu.id, 1, 'editor', 'First');
    const v2 = await save(menu.id, 1, { ...menu.draft, title: { he: 'שני' } });
    await publish(menu.id, v2, 'owner', 'Second');
    const res = (await call('GET', `/api/menus/${menu.id}/versions`, 'viewer')).json();
    expect(res.publication).toMatchObject({ version: 2, publishedBy: 'OWNER' });
    expect(res.versions.map((v: { version: number; note: string; live: boolean; createdBy: string }) => [v.version, v.note, v.live, v.createdBy])).toEqual([
      [2, 'Second', true, 'OWNER'],
      [1, 'First', false, 'EDITOR'],
    ]);
    expect(res.versions[0]).not.toHaveProperty('data');
  });

  it('restores a version into the draft (owner only) without changing what is live', async () => {
    const menu = await createMenu();
    await publish(menu.id, 1);
    const v2 = await save(menu.id, 1, { ...menu.draft, title: { he: 'שני' } });
    await publish(menu.id, v2);
    const versions = (await call('GET', `/api/menus/${menu.id}/versions`, 'viewer')).json().versions;
    const first = versions.find((v: { version: number }) => v.version === 1).id;

    expect((await call('POST', `/api/menus/${menu.id}/restore/${first}`, 'editor')).statusCode).toBe(403);
    const res = await call('POST', `/api/menus/${menu.id}/restore/${first}`, 'owner');
    expect(res.statusCode).toBe(200);
    expect(res.json().menu).toMatchObject({ draftVersion: v2 + 1, draft: { title: { he: 'לומייר' } } });
    expect((await call('GET', '/m/lumiere', 'anon')).body).toContain('<title>שני</title>');
    // Other devices see the restored draft as a newer version (and get a conflict if they have edits).
    expect((await call('GET', `/api/menus/${menu.id}`, 'viewer')).json().menu.draftVersion).toBe(v2 + 1);
  });

  it('does not restore a version of another menu (IDOR)', async () => {
    const a = await createMenu();
    const b = await createMenu({ ...createSampleMenu(), title: { en: 'Other' } });
    await publish(b.id, 1);
    const bVersion = (await call('GET', `/api/menus/${b.id}/versions`, 'viewer')).json().versions[0].id;
    expect((await call('POST', `/api/menus/${a.id}/restore/${bVersion}`, 'owner')).statusCode).toBe(404);
    expect((await call('POST', `/api/menus/${a.id}/restore/not-a-uuid`, 'owner')).statusCode).toBe(404);
  });

  it('unpublishes (owner) and republishes at the same address', async () => {
    const menu = await createMenu();
    await publish(menu.id, 1);
    expect((await call('POST', `/api/menus/${menu.id}/unpublish`, 'owner')).statusCode).toBe(204);
    expect((await call('GET', '/m/lumiere', 'anon')).statusCode).toBe(404);
    expect(files()).toEqual([]);
    expect((await call('POST', `/api/menus/${menu.id}/unpublish`, 'owner')).statusCode).toBe(404);
    expect((await publish(menu.id, 1)).json().publication.url).toBe('http://localhost:5173/m/lumiere');
    const actions = (await db.query<{ action: string }>("SELECT action FROM audit_log WHERE target_type = 'menu' ORDER BY id")).map((r) => r.action);
    expect(actions).toEqual(['menu.create', 'menu.publish', 'menu.unpublish', 'menu.publish']);
  });

  it('removes the public page when the menu is deleted', async () => {
    const menu = await createMenu();
    await publish(menu.id, 1);
    expect((await call('DELETE', `/api/menus/${menu.id}`, 'owner')).statusCode).toBe(204);
    expect((await call('GET', '/m/lumiere', 'anon')).statusCode).toBe(404);
    expect(files()).toEqual([]);
  });

  it(`keeps at most ${MAX_VERSIONS} versions, never pruning the live one`, async () => {
    const menu = await createMenu();
    await db.query(
      `INSERT INTO menu_versions (menu_id, version, data) SELECT $1, g, $2 FROM generate_series(1, ${MAX_VERSIONS + 5}) g`,
      [menu.id, JSON.stringify(menu.draft)],
    );
    const res = await publish(menu.id, 1);
    expect(res.json().version).toBe(MAX_VERSIONS + 6);
    const [count] = await db.query<{ n: string }>('SELECT count(*) AS n FROM menu_versions WHERE menu_id = $1', [menu.id]);
    expect(Number(count!.n)).toBe(MAX_VERSIONS);
  });
});

describe('helpers', () => {
  it('builds public URLs next to the editor', () => {
    expect(publicUrl('https://menu.example.com', 'x')).toBe('https://menu.example.com/m/x');
    expect(publicUrl('https://example.com/menus/', 'x')).toBe('https://example.com/menus/m/x');
  });

  it('resolves bundled font paths', () => {
    const file = FONT_FILES[0]!;
    expect(existsSync(fontPath(file.url))).toBe(true);
    expect(fontPath('./fonts/a.woff2')).toMatch(/fonts\/a\.woff2$/);
  });

  it('never writes outside the publish folder', async () => {
    const store = createFileStore(config.PUBLISH_DIR);
    await expect(store.write('../evil', 'x')).rejects.toThrow('invalid slug');
    expect(await store.read('../../etc/passwd')).toBeNull();
    await store.write('ok', '<p>ok</p>');
    expect(readFileSync(path.join(config.PUBLISH_DIR, 'ok.html'), 'utf8')).toBe('<p>ok</p>');
    const first = (await store.read('ok'))!;
    expect(first.html.toString()).toBe('<p>ok</p>');
    await new Promise((r) => setTimeout(r, 20));
    await store.write('ok', '<p>changed</p>');
    expect((await store.read('ok'))!.etag).not.toBe(first.etag);
  });
});
