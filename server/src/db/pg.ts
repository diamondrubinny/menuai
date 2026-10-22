/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import pg from 'pg';
import type { SqlClient } from './sql';

function wrap(run: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>): Omit<SqlClient, 'transaction' | 'close'> {
  return {
    exec: async (sql) => {
      await run(sql);
    },
    query: async <T,>(sql: string, params?: unknown[]) => (await run(sql, params)).rows as T[],
  };
}

export interface PgOptions {
  /** Called when an idle pooled connection fails (e.g. the database restarted). */
  onError?: (err: Error) => void;
}

/** Production client backed by a node-postgres pool. */
export function createPgClient(connectionString: string, options: PgOptions = {}): SqlClient {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // A runaway query must not hold a connection forever.
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  // Without this listener, an error on an idle client (DB restart, network blip) crashes the process.
  // The pool discards the broken client and opens a new one on the next query.
  pool.on('error', (err) => options.onError?.(err));
  return {
    ...wrap((sql, params) => pool.query(sql, params)),
    async transaction(fn) {
      const conn = await pool.connect();
      const tx: SqlClient = {
        ...wrap((sql, params) => conn.query(sql, params)),
        transaction: (inner) => inner(tx),
        close: async () => {},
      };
      try {
        await conn.query('BEGIN');
        const result = await fn(tx);
        await conn.query('COMMIT');
        return result;
      } catch (err) {
        await conn.query('ROLLBACK');
        throw err;
      } finally {
        conn.release();
      }
    },
    close: () => pool.end(),
  };
}
