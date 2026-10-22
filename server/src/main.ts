/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { loadConfig } from './config';
import { createPgClient } from './db/pg';
import { migrate } from './db/migrate';
import { buildApp } from './app';
import { createSmtpMailer, disabledMailer } from './mail/mailer';
import { CREDIT_LINE } from '../../src/core/brand';

async function main() {
  const config = loadConfig(process.env);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const db = createPgClient(config.DATABASE_URL, {
    onError: (err) => (app ? app.log.warn({ err: err.message }, 'idle database connection lost') : undefined),
  });
  const applied = await migrate(db);
  const mailer = config.SMTP_URL && config.MAIL_FROM ? createSmtpMailer(config.SMTP_URL, config.MAIL_FROM) : disabledMailer;
  app = await buildApp({ config, db, mailer });
  app.log.info(CREDIT_LINE);
  if (!mailer.configured) app.log.warn('SMTP_URL is not set: no emails will be sent. Owners sign in with: node dist-server/cli.mjs login-link <email>');
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
