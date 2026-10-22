import { loadConfig } from './config';
import { createPgClient } from './db/pg';
import { migrate } from './db/migrate';
import { buildApp } from './app';

async function main() {
  const config = loadConfig(process.env);
  const db = createPgClient(config.DATABASE_URL);
  const applied = await migrate(db);
  const app = await buildApp({ config, db });
  if (applied.length) app.log.info({ applied }, 'database migrated');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err: unknown) => {
  // Config errors are already readable; anything else gets a generic line without secrets.
  console.error(err instanceof Error ? err.message : 'Failed to start');
  process.exit(1);
});
