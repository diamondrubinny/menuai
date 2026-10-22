/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { SqlClient } from './sql';
import { MIGRATIONS, type Migration } from './migrations';

/**
 * Applies pending migrations in order, each in its own transaction.
 * An advisory lock prevents two server instances from migrating at the same time.
 */
export async function migrate(db: SqlClient, migrations: Migration[] = MIGRATIONS): Promise<string[]> {
  const applied: string[] = [];
  await db.transaction(async (tx) => {
    // Take the lock first: even CREATE TABLE IF NOT EXISTS can fail when two instances race.
    await tx.query('SELECT pg_advisory_xact_lock(4242)');
    await tx.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set((await tx.query<{ id: string }>('SELECT id FROM schema_migrations')).map((r) => r.id));
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      await tx.exec(m.sql);
      await tx.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
      applied.push(m.id);
    }
  });
  return applied;
}
