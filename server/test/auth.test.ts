/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { captureMailer, ORIGIN, testApp, testDb } from './helpers';
import { hashToken } from '../src/auth/tokens';
import { runCli } from '../src/cli';
import type { SqlClient } from '../src/db/sql';
import type { Mail } from '../src/mail/mailer';

let app: FastifyInstance;
let db: SqlClient;
let sent: Mail[];

const tokenFrom = (text: string) => /#\/login\?token=([A-Za-z0-9_-]{43})/.exec(text)?.[1];

async function seedUser(email: string, role: 'owner' | 'editor' | 'viewer') {
  const [row] = await db.query<{ id: string }>('INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id', [email, role]);
  return row!.id;
}

async function post(url: string, payload?: unknown, cookie?: string) {
  return app.inject({ method: 'POST', url, payload: payload as object, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
}

/** Full magic-link flow; returns the session cookie header value. */
async function signIn(email: string): Promise<string> {
  sent.length = 0;
  await post('/api/auth/request-link', { email });
  const token = tokenFrom(sent[0]!.text);
  const res = await post('/api/auth/verify', { token });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'menuai_session')!;
  return `menuai_session=${cookie.value}`;
}

beforeEach(async () => {
  db = await testDb();
  const mailer = captureMailer();
  sent = mailer.sent;
  ({ app } = await testApp({ db, mailer }));
});
afterEach(() => app.close());

describe('magic link sign-in', () => {
  it('emails a link and signs in with a hardened session cookie', async () => {
    await seedUser('owner@example.com', 'owner');
    const res = await post('/api/auth/request-link', { email: ' Owner@Example.com ' });
    expect(res.statusCode).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('owner@example.com');
    const token = tokenFrom(sent[0]!.text);
    expect(token).toBeDefined();

    const verify = await post('/api/auth/verify', { token });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().user).toMatchObject({ email: 'owner@example.com', role: 'owner' });
    const cookie = verify.cookies.find((c) => c.name === 'menuai_session')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api' });
    expect(cookie.maxAge).toBe(30 * 24 * 60 * 60);

    const me = await app.inject({ url: '/api/me', headers: { cookie: `menuai_session=${cookie.value}` } });
    expect(me.json().user.email).toBe('owner@example.com');
  });

  it('answers identically for unknown and disabled addresses (no enumeration) and sends nothing', async () => {
    const id = await seedUser('gone@example.com', 'editor');
    await db.query('UPDATE users SET disabled_at = now() WHERE id = $1', [id]);
    const unknown = await post('/api/auth/request-link', { email: 'nobody@example.com' });
    const disabled = await post('/api/auth/request-link', { email: 'gone@example.com' });
    expect([unknown.statusCode, disabled.statusCode]).toEqual([202, 202]);
    expect(unknown.body).toBe(disabled.body);
    expect(sent).toHaveLength(0);
  });

  it('stores only hashes of login and session tokens', async () => {
    await seedUser('owner@example.com', 'owner');
    await post('/api/auth/request-link', { email: 'owner@example.com' });
    const token = tokenFrom(sent[0]!.text)!;
    const [stored] = await db.query<{ token_hash: string }>('SELECT token_hash FROM login_tokens');
    expect(stored!.token_hash).toBe(hashToken(token));
    expect(stored!.token_hash).not.toContain(token);
    const res = await post('/api/auth/verify', { token });
    const session = res.cookies.find((c) => c.name === 'menuai_session')!.value;
    const [s] = await db.query<{ token_hash: string }>('SELECT token_hash FROM sessions');
    expect(s!.token_hash).toBe(hashToken(session));
  });

  it('links are single use, expire, and die when the user is disabled', async () => {
    const id = await seedUser('owner@example.com', 'owner');
    await post('/api/auth/request-link', { email: 'owner@example.com' });
    const first = tokenFrom(sent[0]!.text);
    expect((await post('/api/auth/verify', { token: first })).statusCode).toBe(200);
    expect((await post('/api/auth/verify', { token: first })).json()).toEqual({ error: 'invalid_or_expired' });

    await post('/api/auth/request-link', { email: 'owner@example.com' });
    const expired = tokenFrom(sent[1]!.text);
    await db.query("UPDATE login_tokens SET expires_at = now() - interval '1 second' WHERE used_at IS NULL");
    expect((await post('/api/auth/verify', { token: expired })).statusCode).toBe(400);

    await post('/api/auth/request-link', { email: 'owner@example.com' });
    const third = tokenFrom(sent[2]!.text);
    await db.query('UPDATE users SET disabled_at = now() WHERE id = $1', [id]);
    expect((await post('/api/auth/verify', { token: third })).statusCode).toBe(400);
  });

  it('using one link invalidates the other outstanding links', async () => {
    await seedUser('owner@example.com', 'owner');
    await post('/api/auth/request-link', { email: 'owner@example.com' });
    await post('/api/auth/request-link', { email: 'owner@example.com' });
    const [a, b] = sent.map((m) => tokenFrom(m.text));
    expect((await post('/api/auth/verify', { token: b })).statusCode).toBe(200);
    expect((await post('/api/auth/verify', { token: a })).statusCode).toBe(400);
  });

  it('limits links per user to stop inbox flooding', async () => {
    await seedUser('owner@example.com', 'owner');
    for (let i = 0; i < 5; i++) await post('/api/auth/request-link', { email: 'owner@example.com' });
    expect(sent).toHaveLength(3);
  });

  it('rejects malformed input without touching sessions', async () => {
    expect((await post('/api/auth/request-link', { email: 'not-an-email' })).statusCode).toBe(400);
    for (const token of [undefined, 42, 'short', "' OR 1=1 --", 'x'.repeat(43) + 'x']) {
      expect((await post('/api/auth/verify', { token })).statusCode).toBe(400);
    }
    const forged = await app.inject({ url: '/api/me', headers: { cookie: 'menuai_session=' + 'A'.repeat(43) } });
    expect(forged.statusCode).toBe(401);
  });

  it('sign-out revokes the session server-side', async () => {
    await seedUser('owner@example.com', 'owner');
    const cookie = await signIn('owner@example.com');
    const out = await post('/api/auth/sign-out', undefined, cookie);
    expect(out.statusCode).toBe(204);
    expect((await app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('expired sessions are rejected', async () => {
    await seedUser('owner@example.com', 'owner');
    const cookie = await signIn('owner@example.com');
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    expect((await app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('never logs the token, even though it travels in the body', async () => {
    const logs: string[] = [];
    await app.close();
    ({ app } = await testApp({ db, logs, mailer: captureMailer() }));
    await seedUser('owner@example.com', 'owner');
    await post('/api/auth/verify', { token: 'T'.repeat(43) });
    expect(logs.join('\n')).not.toContain('T'.repeat(43));
  });
});

describe('CSRF protection', () => {
  it('rejects data-changing requests from another origin or without an origin', async () => {
    await seedUser('owner@example.com', 'owner');
    const cookie = await signIn('owner@example.com');
    const evil = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { origin: 'https://evil.example', cookie } });
    const none = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie } });
    expect([evil.statusCode, none.statusCode]).toEqual([403, 403]);
    expect((await app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(200);
  });
});

describe('roles and user management', () => {
  let owner: string;
  let editor: string;
  let viewer: string;

  beforeEach(async () => {
    await seedUser('owner@example.com', 'owner');
    await seedUser('editor@example.com', 'editor');
    await seedUser('viewer@example.com', 'viewer');
    owner = await signIn('owner@example.com');
    editor = await signIn('editor@example.com');
    viewer = await signIn('viewer@example.com');
  });

  const anyId = '00000000-0000-4000-8000-000000000000';
  const ownerEndpoints = [
    { method: 'GET' as const, url: '/api/users' },
    { method: 'POST' as const, url: '/api/users', payload: { email: 'new@example.com', role: 'viewer' } },
    { method: 'PATCH' as const, url: `/api/users/${anyId}`, payload: { name: 'x' } },
    { method: 'POST' as const, url: `/api/users/${anyId}/invite` },
  ];

  it.each(ownerEndpoints)('$method $url: anonymous 401, viewer/editor 403', async (ep) => {
    const call = (cookie?: string) =>
      app.inject({ method: ep.method, url: ep.url, payload: ep.payload, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
    expect((await call()).statusCode).toBe(401);
    expect((await call(viewer)).statusCode).toBe(403);
    expect((await call(editor)).statusCode).toBe(403);
  });

  it('owner invites a user who can then sign in with the emailed link', async () => {
    sent.length = 0;
    const res = await app.inject({
      method: 'POST', url: '/api/users', headers: { origin: ORIGIN, cookie: owner },
      payload: { email: 'Chef@Example.com', name: 'Chef', role: 'editor' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: 'chef@example.com', role: 'editor', disabled: false });
    expect(res.json().inviteLink).toBeUndefined(); // emailed, not returned
    expect(sent[0]!.subject).toContain('הזמנה');
    expect((await post('/api/auth/verify', { token: tokenFrom(sent[0]!.text) })).json().user.role).toBe('editor');

    const dup = await app.inject({ method: 'POST', url: '/api/users', headers: { origin: ORIGIN, cookie: owner }, payload: { email: 'chef@example.com', role: 'viewer' } });
    expect(dup.json()).toEqual({ error: 'email_taken' });
  });

  it('returns the invite link to the owner when no email provider is configured', async () => {
    await app.close();
    ({ app } = await testApp({ db, mailer: captureMailer(false) }));
    const res = await app.inject({ method: 'POST', url: '/api/users', headers: { origin: ORIGIN, cookie: owner }, payload: { email: 'x@example.com', role: 'viewer' } });
    expect(tokenFrom(res.json().inviteLink)).toBeDefined();
  });

  it('rejects unknown fields and invalid roles (no mass assignment)', async () => {
    const call = (payload: object) => app.inject({ method: 'POST', url: '/api/users', headers: { origin: ORIGIN, cookie: owner }, payload });
    expect((await call({ email: 'a@example.com', role: 'admin' })).statusCode).toBe(400);
    expect((await call({ email: 'a@example.com', role: 'viewer', id: 'x' })).statusCode).toBe(400);
  });

  it('disabling a user ends their sessions immediately', async () => {
    const [{ id }] = (await db.query<{ id: string }>("SELECT id FROM users WHERE email = 'editor@example.com'")) as [{ id: string }];
    const res = await app.inject({ method: 'PATCH', url: `/api/users/${id}`, headers: { origin: ORIGIN, cookie: owner }, payload: { disabled: true } });
    expect(res.json().user.disabled).toBe(true);
    expect((await app.inject({ url: '/api/me', headers: { cookie: editor } })).statusCode).toBe(401);
  });

  it('role changes take effect on the very next request', async () => {
    const [{ id }] = (await db.query<{ id: string }>("SELECT id FROM users WHERE email = 'editor@example.com'")) as [{ id: string }];
    await app.inject({ method: 'PATCH', url: `/api/users/${id}`, headers: { origin: ORIGIN, cookie: owner }, payload: { role: 'owner' } });
    expect((await app.inject({ url: '/api/users', headers: { cookie: editor } })).statusCode).toBe(200);
  });

  it('never leaves the business without an active owner', async () => {
    const [{ id }] = (await db.query<{ id: string }>("SELECT id FROM users WHERE email = 'owner@example.com'")) as [{ id: string }];
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/users/${id}`, headers: { origin: ORIGIN, cookie: owner }, payload });
    expect((await patch({ role: 'editor' })).json()).toEqual({ error: 'last_owner' });
    expect((await patch({ disabled: true })).json()).toEqual({ error: 'last_owner' });
  });

  it('writes an audit trail without personal content', async () => {
    await app.inject({ method: 'POST', url: '/api/users', headers: { origin: ORIGIN, cookie: owner }, payload: { email: 'a@example.com', role: 'viewer' } });
    const rows = await db.query<{ action: string; meta: Record<string, unknown> }>('SELECT action, meta FROM audit_log ORDER BY id');
    expect(rows.map((r) => r.action)).toContain('user.invite');
    expect(JSON.stringify(rows)).not.toContain('a@example.com');
  });
});

describe('CLI', () => {
  it('create-owner makes the first owner and prints a working link; login-link works after', async () => {
    const created = await runCli(['create-owner', 'Boss@Example.com', 'The', 'Boss'], db, ORIGIN);
    expect(created.code).toBe(0);
    const token = tokenFrom(created.out);
    expect((await post('/api/auth/verify', { token })).json().user).toMatchObject({ email: 'boss@example.com', name: 'The Boss', role: 'owner' });

    expect((await runCli(['create-owner', 'boss@example.com'], db, ORIGIN)).code).toBe(1);
    const link = await runCli(['login-link', 'boss@example.com'], db, ORIGIN);
    expect(link.code).toBe(0);
    expect(tokenFrom(link.out)).toBeDefined();
  });

  it('validates its input', async () => {
    expect((await runCli([], db, ORIGIN)).code).toBe(2);
    expect((await runCli(['create-owner', 'not-an-email'], db, ORIGIN)).code).toBe(2);
    expect((await runCli(['login-link', 'nobody@example.com'], db, ORIGIN)).code).toBe(1);
  });
});
