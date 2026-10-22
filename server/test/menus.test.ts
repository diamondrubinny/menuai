/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ORIGIN, testApp, testDb } from './helpers';
import { issueLoginToken, redeemLoginToken } from '../src/auth/service';
import type { SqlClient } from '../src/db/sql';
import { createEmptyMenu, createSampleMenu } from '../../src/core/sample';
import { MAX_MENUS, parseVersionHeader, slugFromMenu } from '../src/menus/routes';
import type { Menu } from '../../src/core/schema';

let app: FastifyInstance;
let db: SqlClient;
const cookies: Record<'owner' | 'editor' | 'viewer', string> = { owner: '', editor: '', viewer: '' };

async function seed(role: 'owner' | 'editor' | 'viewer') {
  const [row] = await db.query<{ id: string }>(
    'INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id',
    [`${role}@example.com`, role.toUpperCase(), role],
  );
  const login = await issueLoginToken(db, row!.id, 15);
  const session = await redeemLoginToken(db, login!, 'test');
  cookies[role] = `menuai_session=${session!.sessionToken}`;
}

type As = keyof typeof cookies | 'anon';

function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, as: As, opts: { payload?: unknown; headers?: Record<string, string> } = {}) {
  return app.inject({
    method,
    url,
    payload: opts.payload as object,
    headers: { origin: ORIGIN, ...(as === 'anon' ? {} : { cookie: cookies[as] }), ...opts.headers },
  });
}

function titled(en: string): Menu {
  const menu = createEmptyMenu('en');
  return { ...menu, title: { en } };
}

async function create(menu: Menu = createSampleMenu(), as: As = 'editor', slug?: string) {
  return call('POST', '/api/menus', as, { payload: { menu, ...(slug ? { slug } : {}) } });
}

beforeEach(async () => {
  db = await testDb();
  ({ app } = await testApp({ db }));
  await seed('owner');
  await seed('editor');
  await seed('viewer');
});
afterEach(() => app.close());

describe('menus API — permissions', () => {
  it('requires a session for every route', async () => {
    const id = crypto.randomUUID();
    for (const [method, url] of [['GET', '/api/menus'], ['POST', '/api/menus'], ['GET', `/api/menus/${id}`], ['PUT', `/api/menus/${id}`], ['DELETE', `/api/menus/${id}`]] as const) {
      const res = await call(method, url, 'anon', { payload: method === 'POST' || method === 'PUT' ? {} : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('lets viewers read but not write', async () => {
    const created = (await create()).json().menu;
    expect((await call('GET', '/api/menus', 'viewer')).statusCode).toBe(200);
    expect((await call('GET', `/api/menus/${created.id}`, 'viewer')).statusCode).toBe(200);
    expect((await create(createSampleMenu(), 'viewer')).statusCode).toBe(403);
    const put = await call('PUT', `/api/menus/${created.id}`, 'viewer', { payload: created.draft, headers: { 'if-match': '"1"' } });
    expect(put.statusCode).toBe(403);
    expect((await call('DELETE', `/api/menus/${created.id}`, 'viewer')).statusCode).toBe(403);
  });

  it('only lets owners delete, and audits it', async () => {
    const created = (await create()).json().menu;
    expect((await call('DELETE', `/api/menus/${created.id}`, 'editor')).statusCode).toBe(403);
    expect((await call('DELETE', `/api/menus/${created.id}`, 'owner')).statusCode).toBe(204);
    expect((await call('GET', `/api/menus/${created.id}`, 'owner')).statusCode).toBe(404);
    expect((await call('DELETE', `/api/menus/${created.id}`, 'owner')).statusCode).toBe(404);
    const actions = await db.query<{ action: string }>("SELECT action FROM audit_log WHERE target_type = 'menu' ORDER BY id");
    expect(actions.map((a) => a.action)).toEqual(['menu.create', 'menu.delete']);
  });

  it('rejects writes from another origin (CSRF)', async () => {
    const res = await call('POST', '/api/menus', 'editor', { payload: { menu: createSampleMenu() }, headers: { origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(403);
    expect(await db.query('SELECT 1 FROM menus')).toHaveLength(0);
  });
});

describe('menus API — create and list', () => {
  it('creates a menu from the shared schema and lists it without its content', async () => {
    const res = await create(titled('Café Lumière'));
    expect(res.statusCode).toBe(201);
    expect(res.headers.etag).toBe('"1"');
    const menu = res.json().menu;
    expect(menu).toMatchObject({ slug: 'cafe-lumiere', draftVersion: 1, updatedBy: 'EDITOR' });
    expect(menu.draft.title.en).toBe('Café Lumière');

    const list = (await call('GET', '/api/menus', 'viewer')).json().menus;
    expect(list).toEqual([expect.objectContaining({ id: menu.id, slug: 'cafe-lumiere', title: 'Café Lumière', draftVersion: 1, updatedBy: 'EDITOR' })]);
    expect(list[0]).not.toHaveProperty('draft');
  });

  it('derives unique slugs and falls back to "menu" for non-Latin titles', async () => {
    expect((await create(titled('Bistro'))).json().menu.slug).toBe('bistro');
    expect((await create(titled('Bistro'))).json().menu.slug).toBe('bistro-2');
    expect((await create(titled('Bistro!'))).json().menu.slug).toBe('bistro-3');
    const hebrew = { ...createEmptyMenu('he'), title: { he: 'ביסטרו' } };
    expect((await create(hebrew)).json().menu.slug).toBe('menu');
    expect(slugFromMenu({ ...createEmptyMenu('he'), title: { he: 'ביסטרו', en: 'The Bistro' } })).toBe('the-bistro');
  });

  it('honours an explicit slug and reports when it is taken', async () => {
    expect((await create(titled('A'), 'editor', 'my-menu')).json().menu.slug).toBe('my-menu');
    const taken = await create(titled('B'), 'editor', 'my-menu');
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({ error: 'slug_taken' });
    expect((await create(titled('C'), 'editor', 'Bad Slug')).statusCode).toBe(400);
  });

  it('validates the menu on the server and strips unknown fields', async () => {
    const bad = await call('POST', '/api/menus', 'editor', { payload: { menu: { ...createSampleMenu(), locales: [] } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'invalid_menu' });
    expect((await call('POST', '/api/menus', 'editor', { payload: { menu: createSampleMenu(), extra: 1 } })).statusCode).toBe(400);

    const sneaky = { ...createSampleMenu(), injected: '<script>' };
    const created = (await create(sneaky as Menu)).json().menu;
    expect(created.draft).not.toHaveProperty('injected');
    const [row] = await db.query<{ has: boolean }>("SELECT draft ? 'injected' AS has FROM menus WHERE id = $1", [created.id]);
    expect(row!.has).toBe(false);
  });

  it('caps the number of menus', async () => {
    await db.query(
      `INSERT INTO menus (slug, draft) SELECT 'm-' || g, '{}'::jsonb FROM generate_series(1, ${MAX_MENUS}) g`,
    );
    const res = await create();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'too_many_menus' });
  });

  it('returns 404 for malformed or unknown ids without leaking details', async () => {
    expect((await call('GET', '/api/menus/not-a-uuid', 'viewer')).json()).toEqual({ error: 'not_found' });
    expect((await call('GET', `/api/menus/${crypto.randomUUID()}`, 'viewer')).statusCode).toBe(404);
  });
});

describe('menus API — optimistic locking', () => {
  it('saves with a matching If-Match and bumps the version', async () => {
    const created = (await create()).json().menu;
    const next = { ...created.draft, title: { ...created.draft.title, en: 'Updated' } };
    const res = await call('PUT', `/api/menus/${created.id}`, 'editor', { payload: next, headers: { 'if-match': '"1"' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe('"2"');
    expect(res.json().menu).toMatchObject({ id: created.id, draftVersion: 2, updatedBy: 'EDITOR' });
    expect((await call('GET', `/api/menus/${created.id}`, 'viewer')).json().menu.draft.title.en).toBe('Updated');
  });

  it('rejects a stale version with 409 and the current version details, without changing anything', async () => {
    const created = (await create()).json().menu;
    const ok = await call('PUT', `/api/menus/${created.id}`, 'owner', { payload: created.draft, headers: { 'if-match': '"1"' } });
    expect(ok.statusCode).toBe(200);
    const stale = { ...created.draft, title: { en: 'Stale' } };
    const res = await call('PUT', `/api/menus/${created.id}`, 'editor', { payload: stale, headers: { 'if-match': '"1"' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'version_conflict', draftVersion: 2, updatedBy: 'OWNER' });
    const current = (await call('GET', `/api/menus/${created.id}`, 'viewer')).json().menu;
    expect(current.draftVersion).toBe(2);
    expect(current.draft.title.en).not.toBe('Stale');
  });

  it('lets exactly one of two concurrent saves of the same version win', async () => {
    const created = (await create()).json().menu;
    const results = await Promise.all(
      ['A', 'B'].map((en) => call('PUT', `/api/menus/${created.id}`, 'editor', { payload: { ...created.draft, title: { en } }, headers: { 'if-match': '"1"' } })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it('requires If-Match (428) and validates the body', async () => {
    const created = (await create()).json().menu;
    const missing = await call('PUT', `/api/menus/${created.id}`, 'editor', { payload: created.draft });
    expect(missing.statusCode).toBe(428);
    expect(missing.json()).toEqual({ error: 'precondition_required' });
    const invalid = await call('PUT', `/api/menus/${created.id}`, 'editor', { payload: { nope: true }, headers: { 'if-match': '"1"' } });
    expect(invalid.statusCode).toBe(400);
    const unknown = await call('PUT', `/api/menus/${crypto.randomUUID()}`, 'editor', { payload: created.draft, headers: { 'if-match': '"1"' } });
    expect(unknown.statusCode).toBe(404);
  });

  it('answers 304 when the client already has the latest version', async () => {
    const created = (await create()).json().menu;
    const same = await call('GET', `/api/menus/${created.id}`, 'viewer', { headers: { 'if-none-match': '"1"' } });
    expect(same.statusCode).toBe(304);
    expect(same.body).toBe('');
    expect(same.headers.etag).toBe('"1"');
    const older = await call('GET', `/api/menus/${created.id}`, 'viewer', { headers: { 'if-none-match': '"0"' } });
    expect(older.statusCode).toBe(200);
  });

  it('parses version headers strictly', () => {
    expect(parseVersionHeader('"12"')).toBe(12);
    expect(parseVersionHeader('W/"3"')).toBe(3);
    expect(parseVersionHeader('7')).toBe(7);
    expect(parseVersionHeader('"1", "2"')).toBeNull();
    expect(parseVersionHeader('*')).toBeNull();
    expect(parseVersionHeader(undefined)).toBeNull();
  });
});

describe('menus API — limits and caching', () => {
  it('accepts menus with embedded images above the default 1MB body limit', async () => {
    const menu = createSampleMenu();
    const png = `data:image/png;base64,${'A'.repeat(1_500_000)}`;
    const big = { ...menu, hero: { src: png, alt: {} } };
    const res = await create(big as Menu);
    expect(res.statusCode).toBe(201);
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await call('POST', '/api/menus', 'editor', { payload: { menu: 'x'.repeat(13 * 1024 * 1024) } });
    expect(res.statusCode).toBe(413);
  });

  it('marks API responses as not cacheable', async () => {
    const res = await call('GET', '/api/menus', 'viewer');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
