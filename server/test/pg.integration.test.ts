/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
// Runs only against a real PostgreSQL (TEST_DATABASE_URL), e.g. the CI service container.
// Covers what an in-process database cannot: real connection loss.
import { afterAll, describe, expect, it } from 'vitest';
import { createPgClient } from '../src/db/pg';
import { migrate } from '../src/db/migrate';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('node-postgres client (real PostgreSQL)', () => {
  const errors: string[] = [];
  const db = createPgClient(url ?? '', { onError: (err) => errors.push(err.message) });
  afterAll(() => db.close());

  it('migrates a real database, idempotently', async () => {
    await migrate(db);
    expect(await migrate(db)).toEqual([]);
    const [row] = await db.query<{ n: string }>("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'");
    expect(Number(row!.n)).toBeGreaterThanOrEqual(9);
  });

  it('survives the database killing its idle connections (no process crash)', async () => {
    await db.query('SELECT 1'); // leaves an idle pooled connection behind
    const admin = createPgClient(url ?? '');
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND usename = current_user",
    );
    await admin.close();
    await new Promise((r) => setTimeout(r, 200));
    expect(errors.some((m) => /terminat/i.test(m))).toBe(true);
    // The pool replaces the dead connection transparently.
    expect(await db.query('SELECT 1 AS ok')).toEqual([{ ok: 1 }]);
  });

  it('aborts runaway queries with the statement timeout', async () => {
    await expect(db.query('SELECT pg_sleep(20)')).rejects.toThrow(/statement timeout/i);
  }, 30_000);

  it('rolls back a failed transaction', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO users (email, role) VALUES ('rollback@example.com', 'viewer')");
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await db.query("SELECT 1 FROM users WHERE email = 'rollback@example.com'")).toHaveLength(0);
  });
});
