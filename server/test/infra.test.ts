/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApp, testDb } from './helpers';
import { loadConfig } from '../src/config';
import { migrate } from '../src/db/migrate';
import { HttpError } from '../src/errors';
import { buildApp } from '../src/app';
import { captureMailer, ORIGIN } from './helpers';
import type { SqlClient } from '../src/db/sql';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('migrations', () => {
  it('create every table and are idempotent', async () => {
    const db = await testDb();
    const tables = (await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    )).map((r) => r.table_name);
    expect(tables).toEqual([
      'audit_log', 'bills', 'dining_tables', 'login_tokens', 'menu_versions', 'menus', 'payment_events', 'payment_refunds', 'payment_settings', 'payments', 'publications',
      'schema_migrations', 'sessions', 'uploads', 'users',
    ]);
    expect(await migrate(db)).toEqual([]);
    await db.close();
  });

  it('enforce data constraints in the database itself', async () => {
    const db = await testDb();
    await expect(db.query("INSERT INTO users (email, role) VALUES ('a@b.co', 'admin')")).rejects.toThrow();
    await db.query("INSERT INTO users (email, role) VALUES ('Owner@Example.com', 'owner')");
    await expect(db.query("INSERT INTO users (email, role) VALUES ('owner@example.com', 'editor')")).rejects.toThrow();
    await expect(db.query("INSERT INTO menus (slug, draft) VALUES ('../etc', '{}')")).rejects.toThrow();
    await db.close();
  });

  it('roll back a failing migration completely', async () => {
    const db = await testDb();
    await expect(
      migrate(db, [{ id: '9999_bad', sql: 'CREATE TABLE half_done (id int); SELECT broken_sql_here;' }]),
    ).rejects.toThrow();
    const rows = await db.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'half_done'");
    expect(rows).toHaveLength(0);
    await db.close();
  });
});

describe('http basics', () => {
  it('reports health without leaking details', async () => {
    ({ app } = await testApp());
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('returns 503 when the database is down', async () => {
    const broken: SqlClient = {
      exec: async () => { throw new Error('connection refused to 10.0.0.5'); },
      query: async () => { throw new Error('connection refused to 10.0.0.5'); },
      transaction: async () => { throw new Error('down'); },
      close: async () => {},
    };
    ({ app } = await testApp({ db: broken }));
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('10.0.0.5');
  });

  it('answers unknown routes with a JSON 404', async () => {
    ({ app } = await testApp());
    const res = await app.inject('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('sends strict security headers', async () => {
    ({ app } = await testApp());
    const res = await app.inject('/api/health');
    expect(res.headers['content-security-policy']).toBe("default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('hides internal errors and maps safe ones', async () => {
    const db = await testDb();
    const instance = await buildApp({ config: (await testApp({ db })).config, db, mailer: captureMailer() });
    instance.get('/boom', async () => { throw new Error('SELECT * FROM secrets failed at /srv/app.ts:12'); });
    instance.get('/denied', async () => { throw new HttpError(403, 'forbidden'); });
    app = instance;
    const boom = await app.inject('/boom');
    expect(boom.statusCode).toBe(500);
    expect(boom.json()).toEqual({ error: 'internal_error' });
    expect(boom.body).not.toMatch(/secrets|app\.ts|stack/);
    const denied = await app.inject('/denied');
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'forbidden' });
  });

  it('rate-limits clients', async () => {
    ({ app } = await testApp({ config: { RATE_LIMIT_PER_MINUTE: '3' } }));
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await app.inject('/api/nope')).statusCode);
    expect(codes).toEqual([404, 404, 404, 429, 429]);
  });

  it('rejects oversized bodies', async () => {
    const db = await testDb();
    const instance = await buildApp({ config: (await testApp({ db })).config, db, mailer: captureMailer() });
    instance.post('/echo', async (req) => req.body);
    app = instance;
    const res = await app.inject({ method: 'POST', url: '/echo', headers: { origin: ORIGIN }, payload: { x: 'a'.repeat(1_100_000) } });
    expect(res.statusCode).toBe(413);
  });

  it('never writes query strings (login tokens) or cookies to the logs', async () => {
    const logs: string[] = [];
    ({ app } = await testApp({ logs }));
    await app.inject({ url: '/api/auth/verify?token=SUPERSECRET123', headers: { cookie: 'session=COOKIESECRET' } });
    const all = logs.join('\n');
    expect(all).toContain('/api/auth/verify?[redacted]');
    expect(all).not.toContain('SUPERSECRET123');
    expect(all).not.toContain('COOKIESECRET');
  });
});

describe('config', () => {
  const base = { DATABASE_URL: 'postgres://user:pa55word@db/menuai', PUBLIC_URL: 'https://menu.example.com' };

  it('accepts a valid production config with secure defaults', () => {
    const c = loadConfig(base);
    expect(c.NODE_ENV).toBe('production');
    expect(c.HOST).toBe('127.0.0.1');
    expect(c.SECURE_COOKIES).toBe(true);
  });

  it('treats blank variables as unset (SMTP_URL= in .env, as docker compose passes it)', () => {
    const c = loadConfig({ ...base, SMTP_URL: '', MAIL_FROM: '', LOG_LEVEL: '', SECURE_COOKIES: ' ' });
    expect(c.SMTP_URL).toBeUndefined();
    expect(c.LOG_LEVEL).toBe('info');
    expect(c.SECURE_COOKIES).toBe(true);
  });

  it('requires https in production and MAIL_FROM with SMTP', () => {
    expect(() => loadConfig({ ...base, PUBLIC_URL: 'http://menu.example.com' })).toThrow(/PUBLIC_URL/);
    expect(() => loadConfig({ ...base, SMTP_URL: 'smtp://mail:25' })).toThrow(/MAIL_FROM/);
  });

  it('never echoes secret values in errors', () => {
    try {
      loadConfig({ ...base, PORT: 'not-a-port' });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).toContain('PORT');
      expect(String(err)).not.toContain('pa55word');
    }
  });
});
