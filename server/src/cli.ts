/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
// Administrative commands, run on the server itself (direct database access, no HTTP):
//   node dist-server/cli.mjs create-owner <email> [name]   create the first owner and print a sign-in link
//   node dist-server/cli.mjs login-link <email>            print a one-time sign-in link for an existing user
//   node dist-server/cli.mjs gc-uploads                    delete uploaded images no menu uses any more (also runs daily)
//   node dist-server/cli.mjs retention                     apply the data retention policy now (also runs daily)
//   node dist-server/cli.mjs status                        health of database, virus scanner and disk (exit 1 if not OK)
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
import { collectOrphanUploads } from './uploads/gc';
import { createMediaStore } from './uploads/store';
import { applyRetention } from './maintenance/retention';
import { collectStatus } from './maintenance/status';
import type { Config } from './config';

export async function runCli(args: string[], db: SqlClient, publicUrl: string, config?: Config): Promise<{ code: number; out: string }> {
  const [command, rawEmail, ...nameParts] = args;
  if (config && command === 'gc-uploads') {
    const removed = await collectOrphanUploads(db, createMediaStore(config.UPLOAD_DIR));
    return { code: 0, out: `Removed ${removed} unused image(s).` };
  }
  if (config && command === 'retention') {
    const r = await applyRetention(db, createMediaStore(config.UPLOAD_DIR));
    return {
      code: 0,
      out: `Retention applied: ${r.loginTokens} sign-in links, ${r.sessions} expired sessions, ${r.auditLog} old audit entries, ${r.rejectedUploads} rejected upload records, ${r.stuckUploads} interrupted uploads, ${r.orphanImages} unused images removed; ${r.abandonedPayments} abandoned checkouts expired, ${r.paymentEvents} old payment events removed.`,
    };
  }
  if (config && command === 'status') {
    const checks = await collectStatus(db, config);
    const out = checks.map((c) => `${c.ok ? 'OK  ' : 'FAIL'} ${c.name.padEnd(16)} ${c.detail}`).join('\n');
    return { code: checks.every((c) => c.ok) ? 0 : 1, out };
  }
  const email = z.string().trim().pipe(z.email().max(254)).safeParse(rawEmail ?? '');
  if ((command !== 'create-owner' && command !== 'login-link') || !email.success) {
    return { code: 2, out: 'Usage:\n  create-owner <email> [name]\n  login-link <email>\n  gc-uploads\n  retention\n  status' };
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
      const { code, out } = await runCli(process.argv.slice(2), db, config.PUBLIC_URL, config);
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
