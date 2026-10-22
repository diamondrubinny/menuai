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

/** Production client backed by a node-postgres pool. */
export function createPgClient(connectionString: string): SqlClient {
  const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
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
