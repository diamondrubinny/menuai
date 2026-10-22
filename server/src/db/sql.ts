/** Minimal raw-SQL interface, implemented by both node-postgres (production) and PGlite (tests). */
export interface SqlClient {
  /** Runs one or more statements without parameters. */
  exec(sql: string): Promise<void>;
  /** Runs one parameterized statement. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` inside a transaction (rolled back if it throws). */
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
