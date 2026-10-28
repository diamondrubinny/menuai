/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { SqlClient } from '../db/sql';
import type { MediaStore } from '../uploads/store';
import { collectOrphanUploads } from '../uploads/gc';

/** Retention periods (docs/PHASE2F.md §3 and the data map in docs/PHASE2.md §9). */
export const RETENTION = {
  loginTokenHours: 24,
  auditLogMonths: 12,
  rejectedUploadMonths: 12,
  /** An upload is scanned and processed within seconds; older quarantine rows were interrupted (crash/restart). */
  stuckQuarantineHours: 1,
  /** A checkout nobody finished: the guest closed the provider's page. */
  abandonedPaymentHours: 24,
  /** Provider notification log (no personal data); payments themselves are accounting records and stay. */
  paymentEventMonths: 13,
} as const;

export interface RetentionReport {
  loginTokens: number;
  sessions: number;
  auditLog: number;
  rejectedUploads: number;
  stuckUploads: number;
  orphanImages: number;
  abandonedPayments: number;
  paymentEvents: number;
}

async function count(db: SqlClient, sql: string, params: unknown[] = []): Promise<number> {
  return (await db.query(`${sql} RETURNING 1`, params)).length;
}

async function removeStuck(db: SqlClient, media: MediaStore): Promise<number> {
  const rows = await db.query<{ id: string }>(
    "DELETE FROM uploads WHERE status = 'quarantine' AND created_at < now() - make_interval(hours => $1) RETURNING id",
    [RETENTION.stuckQuarantineHours],
  );
  // Removes both the quarantined original and any half-released public file.
  for (const { id } of rows) await media.remove(id);
  return rows.length;
}

/** Deletes personal and security data that is no longer needed. Safe to run any time (idempotent). */
export async function applyRetention(db: SqlClient, media: MediaStore): Promise<RetentionReport> {
  return {
    // Used or expired sign-in links: useless after expiry, kept a day for troubleshooting.
    loginTokens: await count(
      db,
      "DELETE FROM login_tokens WHERE created_at < now() - make_interval(hours => $1) OR expires_at < now() - make_interval(hours => $1)",
      [RETENTION.loginTokenHours],
    ),
    sessions: await count(db, 'DELETE FROM sessions WHERE expires_at < now()'),
    auditLog: await count(db, 'DELETE FROM audit_log WHERE at < now() - make_interval(months => $1)', [RETENTION.auditLogMonths]),
    rejectedUploads: await count(
      db,
      "DELETE FROM uploads WHERE status = 'rejected' AND created_at < now() - make_interval(months => $1)",
      [RETENTION.rejectedUploadMonths],
    ),
    stuckUploads: await removeStuck(db, media),
    orphanImages: await collectOrphanUploads(db, media),
    abandonedPayments: await count(
      db,
      "UPDATE payments SET status = 'expired' WHERE status = 'pending' AND created_at < now() - make_interval(hours => $1)",
      [RETENTION.abandonedPaymentHours],
    ),
    paymentEvents: await count(db, 'DELETE FROM payment_events WHERE at < now() - make_interval(months => $1)', [RETENTION.paymentEventMonths]),
  };
}
