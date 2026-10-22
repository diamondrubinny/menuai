/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
// Administrative commands, run on the server itself (direct database access, no HTTP):
//   node dist-server/cli.mjs create-owner <email> [name]   create the first owner and print a sign-in link
//   node dist-server/cli.mjs login-link <email>            print a one-time sign-in link for an existing user
// In Docker: docker compose exec api node dist-server/cli.mjs create-owner you@example.com
import { z } from 'zod';
import { loadConfig } from './config';
import { createPgClient } from './db/pg';
import { migrate } from './db/migrate';
import type { SqlClient } from './db/sql';
import {
  audit, findActiveUserByEmail, INVITE_LINK_MINUTES, issueLoginToken, LOGIN_LINK_MINUTES, loginLink, normalizeEmail,
} from './auth/service';
import { CREDIT_LINE } from '../../src/core/brand';

export async function runCli(args: string[], db: SqlClient, publicUrl: string): Promise<{ code: number; out: string }> {
  const [command, rawEmail, ...nameParts] = args;
  const email = z.string().trim().pipe(z.email().max(254)).safeParse(rawEmail ?? '');
  if ((command !== 'create-owner' && command !== 'login-link') || !email.success) {
    return { code: 2, out: 'Usage:\n  create-owner <email> [name]\n  login-link <email>' };
  }

  if (command === 'create-owner') {
    const [existing] = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [normalizeEmail(email.data)]);
    if (existing) return { code: 1, out: `A user with this email already exists. Use: login-link ${email.data}` };
    const [row] = await db.query<{ id: string }>(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'owner') RETURNING id",
      [normalizeEmail(email.data), nameParts.join(' ').slice(0, 120)],
    );
    await audit(db, { userId: null, action: 'cli.create_owner', targetType: 'user', targetId: row!.id });
    const token = await issueLoginToken(db, row!.id, INVITE_LINK_MINUTES);
    return { code: 0, out: `Owner created. One-time sign-in link (valid 24 hours):\n${loginLink(publicUrl, token!)}` };
  }

  const user = await findActiveUserByEmail(db, email.data);
  if (!user) return { code: 1, out: 'No active user with this email.' };
  const token = await issueLoginToken(db, user.id, LOGIN_LINK_MINUTES);
  if (!token) return { code: 1, out: 'Too many links requested for this user. Try again in 15 minutes.' };
  await audit(db, { userId: null, action: 'cli.login_link', targetType: 'user', targetId: user.id });
  return { code: 0, out: `One-time sign-in link (valid ${LOGIN_LINK_MINUTES} minutes):\n${loginLink(publicUrl, token)}` };
}

// Entry point (skipped when imported by tests).
if (process.argv[1] && /cli\.(m?js|ts)$/.test(process.argv[1])) {
  (async () => {
    const config = loadConfig(process.env);
    const db = createPgClient(config.DATABASE_URL);
    try {
      await migrate(db);
      const { code, out } = await runCli(process.argv.slice(2), db, config.PUBLIC_URL);
      (code === 0 ? console.log : console.error)(`${out}\n\n${CREDIT_LINE}`);
      process.exitCode = code;
    } finally {
      await db.close();
    }
  })().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : 'Command failed');
    process.exitCode = 1;
  });
}
