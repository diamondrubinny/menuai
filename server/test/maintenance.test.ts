/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testConfig, testDb } from './helpers';
import type { SqlClient } from '../src/db/sql';
import { applyRetention } from '../src/maintenance/retention';
import { collectStatus } from '../src/maintenance/status';
import { clamdPing } from '../src/uploads/clamd';
import { createMediaStore } from '../src/uploads/store';
import { runCli } from '../src/cli';

let db: SqlClient;
let userId: string;

beforeEach(async () => {
  db = await testDb();
  const [u] = await db.query<{ id: string }>("INSERT INTO users (email, role) VALUES ('o@example.com', 'owner') RETURNING id");
  userId = u!.id;
});

const media = () => createMediaStore(mkdtempSync(path.join(tmpdir(), 'menuai-ret-')));
const n = async (sql: string) => Number((await db.query<{ n: string }>(sql))[0]!.n);

describe('retention policy', () => {
  it('deletes only what is past its retention period', async () => {
    await db.query(
      `INSERT INTO login_tokens (user_id, token_hash, expires_at, created_at) VALUES
         ($1, 'old', now() - interval '47 hours', now() - interval '2 days'),
         ($1, 'fresh', now() + interval '10 minutes', now() - interval '5 minutes')`,
      [userId],
    );
    await db.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'expired', now() - interval '1 minute'), ($1, 'live', now() + interval '29 days')`,
      [userId],
    );
    await db.query(
      `INSERT INTO audit_log (user_id, action, at) VALUES ($1, 'ancient', now() - interval '13 months'), ($1, 'recent', now() - interval '11 months')`,
      [userId],
    );
    await db.query(
      `INSERT INTO uploads (status, mime, bytes, sha256, storage_key, created_at) VALUES
         ('rejected', 'image/png', 10, repeat('a', 64), 'r-old', now() - interval '13 months'),
         ('rejected', 'image/png', 10, repeat('b', 64), 'r-new', now() - interval '1 month')`,
    );

    const report = await applyRetention(db, media());
    expect(report).toEqual({ loginTokens: 1, sessions: 1, auditLog: 1, rejectedUploads: 1, stuckUploads: 0, orphanImages: 0, abandonedPayments: 0, paymentEvents: 0 });
    expect((await db.query<{ token_hash: string }>('SELECT token_hash FROM login_tokens')).map((r) => r.token_hash)).toEqual(['fresh']);
    expect((await db.query<{ token_hash: string }>('SELECT token_hash FROM sessions')).map((r) => r.token_hash)).toEqual(['live']);
    expect((await db.query<{ action: string }>('SELECT action FROM audit_log')).map((r) => r.action)).toEqual(['recent']);
    expect(await n("SELECT count(*) AS n FROM uploads WHERE storage_key = 'r-new'")).toBe(1);

    // Idempotent: a second run deletes nothing more.
    expect(await applyRetention(db, media())).toEqual({ loginTokens: 0, sessions: 0, auditLog: 0, rejectedUploads: 0, stuckUploads: 0, orphanImages: 0, abandonedPayments: 0, paymentEvents: 0 });
  });
});

describe('interrupted uploads', () => {
  it('removes uploads stuck in quarantine (crash mid-scan) with their files, but not ones in progress', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'menuai-stuck-'));
    const store = createMediaStore(dir);
    const stuck = '11111111-2222-4333-8444-555555555555';
    const fresh = '66666666-7777-4888-8999-aaaaaaaaaaaa';
    await store.quarantine(stuck, Buffer.from('x'));
    await store.publish(stuck, Buffer.from('half-released'));
    await store.quarantine(fresh, Buffer.from('y'));
    await db.query(
      `INSERT INTO uploads (id, status, mime, bytes, sha256, storage_key, created_at) VALUES
         ($1, 'quarantine', 'image/png', 1, repeat('a', 64), 'q1', now() - interval '2 hours'),
         ($2, 'quarantine', 'image/png', 1, repeat('b', 64), 'q2', now() - interval '1 minute')`,
      [stuck, fresh],
    );
    const report = await applyRetention(db, store);
    expect(report.stuckUploads).toBe(1);
    expect(await store.read(stuck)).toBeNull();
    expect(existsSync(path.join(dir, 'quarantine', stuck))).toBe(false);
    expect(existsSync(path.join(dir, 'quarantine', fresh))).toBe(true);
    expect((await db.query<{ id: string }>('SELECT id FROM uploads')).map((r) => r.id)).toEqual([fresh]);
  });
});

describe('status', () => {
  let server: Server;
  let port = 0;
  const sockets = new Set<Socket>();
  beforeAll(async () => {
    server = createServer({ allowHalfOpen: true }, (sock) => {
      sockets.add(sock);
      sock.on('data', (d: Buffer) => {
        if (d.toString().startsWith('zPING')) sock.end('PONG\0');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => {
    for (const s of sockets) s.destroy();
    return new Promise<void>((r) => server.close(() => r()));
  });

  it('pings clamd', async () => {
    expect(await clamdPing(`tcp://127.0.0.1:${port}`)).toBe(true);
    expect(await clamdPing('tcp://127.0.0.1:1', 500)).toBe(false);
  });

  it('reports database, scanner and disk, and fails when a dependency is down', async () => {
    const ok = await collectStatus(db, testConfig({ CLAMAV_URL: `tcp://127.0.0.1:${port}` }));
    expect(ok.map((c) => [c.name, c.ok])).toEqual([
      ['database', true],
      ['virus scanner', true],
      ['publish storage', true],
      ['upload storage', true],
    ]);
    expect(ok[0]!.detail).toMatch(/PostgreSQL .* 0 menus \(0 published\) · 1 active users · 0 images/);

    const bad = await collectStatus(db, testConfig({ CLAMAV_URL: 'tcp://127.0.0.1:1', UPLOAD_DIR: '/nonexistent/menuai' }));
    expect(bad.filter((c) => !c.ok).map((c) => c.name)).toEqual(['virus scanner', 'upload storage']);
  });

  it('is available from the CLI with a monitoring-friendly exit code', async () => {
    const good = await runCli(['status'], db, 'https://m.example.com', testConfig({ CLAMAV_URL: `tcp://127.0.0.1:${port}` }));
    expect(good.code).toBe(0);
    expect(good.out).toMatch(/^OK {3}database/m);
    const failing = await runCli(['status'], db, 'https://m.example.com', testConfig({ CLAMAV_URL: 'tcp://127.0.0.1:1' }));
    expect(failing.code).toBe(1);
    expect(failing.out).toMatch(/^FAIL virus scanner/m);
  });

  it('runs retention from the CLI', async () => {
    const res = await runCli(['retention'], db, 'https://m.example.com', testConfig());
    expect(res).toMatchObject({ code: 0 });
    expect(res.out).toMatch(/^Retention applied: 0 sign-in links/);
  });
});
