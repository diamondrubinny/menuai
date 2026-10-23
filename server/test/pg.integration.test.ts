/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
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

  it('lets exactly one of many truly concurrent draft saves of the same version win', async () => {
    const [menu] = await db.query<{ id: string }>(
      "INSERT INTO menus (slug, draft) VALUES ('race-' || substr(md5(random()::text), 1, 8), '{}'::jsonb) RETURNING id",
    );
    // Same statement as PUT /api/menus/:id, on separate pooled connections at once.
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        db.query(
          `UPDATE menus SET draft = $3, draft_version = draft_version + 1, updated_at = now()
           WHERE id = $1 AND draft_version = $2 RETURNING draft_version`,
          [menu!.id, 1, JSON.stringify({ writer: i })],
        ),
      ),
    );
    expect(results.filter((r) => r.length === 1)).toHaveLength(1);
    const [row] = await db.query<{ draft_version: number }>('SELECT draft_version FROM menus WHERE id = $1', [menu!.id]);
    expect(row!.draft_version).toBe(2);
    await db.query('DELETE FROM menus WHERE id = $1', [menu!.id]);
  });
});

describe.skipIf(!url)('delete racing a publish (real PostgreSQL, two connections)', () => {
  it('a menu deleted while it is being published never stays online', async () => {
    const { testApp, ORIGIN } = await import('./helpers');
    const { issueLoginToken, redeemLoginToken } = await import('../src/auth/service');
    const { createFileStore } = await import('../src/publish/store');
    const db = createPgClient(url ?? '');
    await migrate(db);
    const { app, config } = await testApp({ db });
    try {
      const email = `race-${Date.now()}@example.com`;
      const [owner] = await db.query<{ id: string }>("INSERT INTO users (email, role) VALUES ($1, 'owner') RETURNING id", [email]);
      const session = await redeemLoginToken(db, (await issueLoginToken(db, owner!.id, 15))!, 'test');
      const slug = `race-${Date.now()}`;
      const [menu] = await db.query<{ id: string }>("INSERT INTO menus (slug, draft) VALUES ($1, '{}'::jsonb) RETURNING id", [slug]);
      const store = createFileStore(config.PUBLISH_DIR);

      // A publish in progress: holds the menu row lock, has written the page, not yet committed.
      let commit!: () => void;
      const committed = new Promise<void>((r) => { commit = r; });
      const publishing = db.transaction(async (tx) => {
        await tx.query('SELECT 1 FROM menus WHERE id = $1 FOR UPDATE', [menu!.id]);
        const [v] = await tx.query<{ id: string }>("INSERT INTO menu_versions (menu_id, version, data) VALUES ($1, 1, '{}'::jsonb) RETURNING id", [menu!.id]);
        await tx.query('INSERT INTO publications (menu_id, public_slug, version_id) VALUES ($1, $2, $3)', [menu!.id, slug, v!.id]);
        await store.write(slug, '<p>live</p>');
        await committed;
      });

      // The owner deletes the menu meanwhile.
      const deleting = app.inject({ method: 'DELETE', url: `/api/menus/${menu!.id}`, headers: { origin: ORIGIN, cookie: `menuai_session=${session!.sessionToken}` } });
      await new Promise((r) => setTimeout(r, 300)); // the DELETE is now waiting on the row lock
      commit();
      await publishing;
      expect((await deleting).statusCode).toBe(204);
      expect(await store.read(slug)).toBeNull();
      expect((await app.inject({ method: 'GET', url: `/m/${slug}` })).statusCode).toBe(404);
    } finally {
      await app.close();
      await db.close();
    }
  });
});
