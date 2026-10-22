/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { SqlClient } from './sql';

function fromTx(tx: Transaction): SqlClient {
  const client: SqlClient = {
    exec: async (sql) => {
      await tx.exec(sql);
    },
    query: async <T,>(sql: string, params?: unknown[]) => (await tx.query<T>(sql, params)).rows,
    transaction: (fn) => fn(client),
    close: async () => {},
  };
  return client;
}

/** In-process Postgres (WASM) for tests and local development without Docker. */
export async function createPgliteClient(): Promise<SqlClient> {
  const db = await PGlite.create();
  return {
    exec: async (sql) => {
      await db.exec(sql);
    },
    query: async <T,>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows,
    transaction: (fn) => db.transaction((tx) => fn(fromTx(tx))),
    close: () => db.close(),
  };
}
