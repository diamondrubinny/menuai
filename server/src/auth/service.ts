/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { SqlClient } from '../db/sql';
import type { Role } from './roles';
import { generateToken, hashToken, isWellFormedToken } from './tokens';

export const LOGIN_LINK_MINUTES = 15;
export const INVITE_LINK_MINUTES = 24 * 60;
export const SESSION_DAYS = 30;
/** Max login links per user in a 15-minute window (stops inbox flooding). */
export const MAX_LINKS_PER_WINDOW = 3;

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled_at: Date | string | null;
}

const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, role: r.role, disabled: r.disabled_at !== null });

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findActiveUserByEmail(db: SqlClient, email: string): Promise<User | null> {
  const [row] = await db.query<UserRow>(
    'SELECT id, email, name, role, disabled_at FROM users WHERE lower(email) = $1 AND disabled_at IS NULL',
    [normalizeEmail(email)],
  );
  return row ? toUser(row) : null;
}

/**
 * Creates a one-time login token for a user. Returns the raw token (to put in the link) or null
 * if the user already received too many links recently.
 */
export async function issueLoginToken(db: SqlClient, userId: string, minutes: number): Promise<string | null> {
  const [recent] = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM login_tokens WHERE user_id = $1 AND created_at > now() - interval '15 minutes'",
    [userId],
  );
  if (Number(recent?.n ?? 0) >= MAX_LINKS_PER_WINDOW) return null;
  const token = generateToken();
  await db.query(
    "INSERT INTO login_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))",
    [userId, hashToken(token), minutes],
  );
  return token;
}

export function loginLink(publicUrl: string, token: string): string {
  // Hash fragment: never sent to servers (no logs) and not consumed by email link scanners,
  // because the editor page has to POST it explicitly.
  return `${publicUrl.replace(/\/+$/, '')}/#/login?token=${token}`;
}

/**
 * Consumes a login token (single use, atomically) and opens a session.
 * Returns the raw session token, or null if the token is unknown, used, expired or the user is disabled.
 */
export async function redeemLoginToken(
  db: SqlClient,
  token: unknown,
  userAgent: string,
): Promise<{ sessionToken: string; user: User } | null> {
  if (!isWellFormedToken(token)) return null;
  return db.transaction(async (tx) => {
    const [used] = await tx.query<{ user_id: string }>(
      `UPDATE login_tokens SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [hashToken(token)],
    );
    if (!used) return null;
    const [row] = await tx.query<UserRow>(
      'SELECT id, email, name, role, disabled_at FROM users WHERE id = $1 AND disabled_at IS NULL',
      [used.user_id],
    );
    if (!row) return null;
    // Any other outstanding links for this user stop working once one is used.
    await tx.query('DELETE FROM login_tokens WHERE user_id = $1 AND used_at IS NULL', [row.id]);
    const sessionToken = generateToken();
    await tx.query(
      "INSERT INTO sessions (user_id, token_hash, expires_at, user_agent) VALUES ($1, $2, now() + make_interval(days => $3), $4)",
      [row.id, hashToken(sessionToken), SESSION_DAYS, userAgent.slice(0, 300)],
    );
    return { sessionToken, user: toUser(row) };
  });
}

/** Resolves a session cookie to its (active) user and refreshes last_seen_at at most every 5 minutes. */
export async function userForSession(db: SqlClient, sessionToken: unknown): Promise<User | null> {
  if (!isWellFormedToken(sessionToken)) return null;
  const [row] = await db.query<UserRow & { session_id: string; stale: boolean }>(
    `SELECT u.id, u.email, u.name, u.role, u.disabled_at, s.id AS session_id,
            s.last_seen_at < now() - interval '5 minutes' AS stale
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.disabled_at IS NULL`,
    [hashToken(sessionToken)],
  );
  if (!row) return null;
  if (row.stale) await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]);
  return toUser(row);
}

export async function revokeSession(db: SqlClient, sessionToken: unknown): Promise<void> {
  if (!isWellFormedToken(sessionToken)) return;
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(sessionToken)]);
}

export async function revokeAllSessions(db: SqlClient, userId: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM login_tokens WHERE user_id = $1 AND used_at IS NULL', [userId]);
}

export async function audit(
  db: SqlClient,
  entry: { userId: string | null; action: string; targetType?: string; targetId?: string; meta?: Record<string, unknown> },
): Promise<void> {
  await db.query(
    'INSERT INTO audit_log (user_id, action, target_type, target_id, meta) VALUES ($1, $2, $3, $4, $5)',
    [entry.userId, entry.action, entry.targetType ?? null, entry.targetId ?? null, JSON.stringify(entry.meta ?? {})],
  );
}
