import { loadConfig } from './config';
import { createPgClient } from './db/pg';
import { migrate } from './db/migrate';
import { buildApp } from './app';

async function main() {
  const config = loadConfig(process.env);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const db = createPgClient(config.DATABASE_URL, {
    onError: (err) => (app ? app.log.warn({ err: err.message }, 'idle database connection lost') : undefined),
  });
  const applied = await migrate(db);
  app = await buildApp({ config, db });
  if (applied.length) app.log.info({ applied }, 'database migrated');

  const server = app;
  const shutdown = async (signal: string) => {
    server.log.info({ signal }, 'shutting down');
    await server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await server.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err: unknown) => {
  // Config errors are already readable; anything else gets a generic line without secrets.
  console.error(err instanceof Error ? err.message : 'Failed to start');
  process.exit(1);
});
