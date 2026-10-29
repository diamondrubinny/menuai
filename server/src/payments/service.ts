/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config';
import type { SqlClient } from '../db/sql';
import { audit } from '../auth/service';
import { HttpError, notFound } from '../errors';
import { computeCharge, type BillTotals, type Charge, type ShareChoice, type TipChoice } from './money';
import { open, seal } from './crypto';
import { createProvider } from './providers';
import type { Http } from './providers/grow';
import { ProviderError, type Notification, type NotificationContext, type Payer, type Receipt, type VerifiedStatus, type PaymentMode, type PaymentProvider, type ProviderId, type ProviderRef } from './providers/types';

import { RESERVATION_MINUTES } from './reservation';

export { RESERVATION_MINUTES };

// --- settings ---------------------------------------------------------------------------------------

export interface PaymentSettings {
  enabled: boolean;
  provider: ProviderId;
  mode: PaymentMode;
  credentials: Record<string, string> | null;
  tipPercents: number[];
  /** Restaurant's payment terms (https). When set, guests must accept them before paying. */
  termsUrl: string | null;
  updatedAt: Date | null;
}

interface SettingsRow {
  enabled: boolean;
  provider: ProviderId;
  mode: PaymentMode;
  credentials_enc: string | null;
  tip_percents: number[];
  terms_url: string | null;
  updated_at: Date;
}

export const DEFAULT_SETTINGS: PaymentSettings = {
  enabled: false, provider: 'fake', mode: 'test', credentials: null, tipPercents: [10, 12, 15], termsUrl: null, updatedAt: null,
};

export async function loadSettings(db: SqlClient, config: Config): Promise<PaymentSettings> {
  const [row] = await db.query<SettingsRow>(
    'SELECT enabled, provider, mode, credentials_enc, tip_percents, terms_url, updated_at FROM payment_settings WHERE id = 1',
  );
  if (!row) return DEFAULT_SETTINGS;
  let credentials: Record<string, string> | null = null;
  if (row.credentials_enc && config.PAYMENTS_KEY) {
    try {
      credentials = JSON.parse(open(row.credentials_enc, config.PAYMENTS_KEY)) as Record<string, string>;
    } catch {
      // Wrong or rotated key: treat as "no credentials" so the owner re-enters them; never crash or leak.
      credentials = null;
    }
  }
  return {
    enabled: row.enabled,
    provider: row.provider,
    mode: row.mode,
    credentials,
    tipPercents: row.tip_percents.map(Number),
    termsUrl: row.terms_url,
    updatedAt: row.updated_at,
  };
}

export async function saveSettings(
  db: SqlClient,
  config: Config,
  userId: string,
  next: { enabled: boolean; provider: ProviderId; mode: PaymentMode; tipPercents: number[]; termsUrl: string | null; credentials?: Record<string, string> | null },
): Promise<void> {
  if (!config.PAYMENTS_KEY) throw new HttpError(503, 'payments_not_configured');
  // undefined = keep the stored credentials; null = remove them; object = replace them.
  const credentialsSql = next.credentials === undefined ? 'payment_settings.credentials_enc' : '$5';
  const sealed = next.credentials ? seal(JSON.stringify(next.credentials), config.PAYMENTS_KEY) : null;
  await db.query(
    `INSERT INTO payment_settings (id, enabled, provider, mode, credentials_enc, tip_percents, terms_url, updated_by, updated_at)
     VALUES (1, $1, $2, $3, $5, $4, $7, $6, now())
     ON CONFLICT (id) DO UPDATE SET enabled = $1, provider = $2, mode = $3, tip_percents = $4, terms_url = $7,
       credentials_enc = ${credentialsSql}, updated_by = $6, updated_at = now()`,
    [next.enabled, next.provider, next.mode, next.tipPercents, sealed, userId, next.termsUrl],
  );
  await audit(db, {
    userId,
    action: 'payments.settings',
    targetType: 'payments',
    // Never the credentials themselves: only whether they changed.
    meta: { enabled: next.enabled, provider: next.provider, mode: next.mode, credentials: next.credentials === undefined ? 'kept' : next.credentials ? 'replaced' : 'removed' },
  });
}

/** The adapter guests pay through right now, or null when payments are off or not set up. */
export async function activeProvider(
  db: SqlClient,
  config: Config,
  http?: Http,
): Promise<{ provider: PaymentProvider; settings: PaymentSettings } | null> {
  const configured = await configuredProvider(db, config, http);
  return configured?.settings.enabled ? configured : null;
}

/**
 * The provider payments were made through, even while guests can't start new ones (payments switched
 * off). Notifications, return pages and stale-checkout checks use this, so money that is already on
 * its way is still recorded. (Changing the provider, mode or credentials is refused while a checkout
 * is in progress: see the settings route.)
 */
export async function configuredProvider(
  db: SqlClient,
  config: Config,
  http?: Http,
): Promise<{ provider: PaymentProvider; settings: PaymentSettings } | null> {
  if (!config.PAYMENTS_KEY) return null;
  const settings = await loadSettings(db, config);
  const provider = createProvider(config, settings, http);
  return provider ? { provider, settings } : null;
}

// --- tables -----------------------------------------------------------------------------------------

/** 128-bit random table token (22 base64url chars): the table's QR code. Not guessable, not a table number. */
export function newTableToken(): string {
  return randomBytes(16).toString('base64url');
}

export const isTableToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{22}$/.test(t);

// --- bills ------------------------------------------------------------------------------------------

export interface BillRow {
  id: string;
  table_id: string;
  amount_agorot: number;
  note: string;
  status: 'open' | 'paid' | 'closed' | 'cancelled';
  opened_at: Date;
  closed_at: Date | null;
  paid_agorot: number;
  pending_agorot: number;
  tips_agorot: number;
}

/** Bill rows with their paid / reserved / tip sums. `where` uses `b.` for the bill. */
export const BILL_SELECT = `
  SELECT b.id, b.table_id, b.amount_agorot, b.note, b.status, b.opened_at, b.closed_at,
    COALESCE(sum(p.share_agorot) FILTER (WHERE p.status = 'paid'), 0)::int AS paid_agorot,
    COALESCE(sum(p.share_agorot) FILTER (WHERE p.status = 'pending'), 0)::int AS pending_agorot,
    COALESCE(sum(p.tip_agorot) FILTER (WHERE p.status = 'paid'), 0)::int AS tips_agorot
  FROM bills b LEFT JOIN payments p ON p.bill_id = b.id`;

export const totalsOf = (b: BillRow): BillTotals => ({ amount: b.amount_agorot, paid: b.paid_agorot, pending: b.pending_agorot });

export interface GuestTable {
  id: string;
  label: string;
  menuId: string | null;
}

export async function tableByToken(db: SqlClient, token: string): Promise<GuestTable | null> {
  if (!isTableToken(token)) return null;
  const [row] = await db.query<{ id: string; label: string; menu_id: string | null }>(
    'SELECT id, label, menu_id FROM dining_tables WHERE token = $1 AND active',
    [token],
  );
  return row ? { id: row.id, label: row.label, menuId: row.menu_id } : null;
}

export async function openBillForTable(db: SqlClient, tableId: string): Promise<BillRow | null> {
  const [bill] = await db.query<BillRow>(`${BILL_SELECT} WHERE b.table_id = $1 AND b.status = 'open' GROUP BY b.id`, [tableId]);
  return bill ?? null;
}

// --- checkout ---------------------------------------------------------------------------------------

export interface CheckoutInput {
  table: GuestTable;
  share: ShareChoice;
  tip: TipChoice;
  payer: Payer;
  locale: string;
  /** Builds the provider-facing URLs for a payment id (and its receipt-callback key, when the provider has one). */
  urls: (paymentId: string, receiptKey: string | null) => { successUrl: string; cancelUrl: string; notifyUrl: string; receiptNotifyUrl?: string };
  description: string;
}

/**
 * Reserves the guest's share and opens the provider's payment page. The bill row is locked while the
 * amounts are computed, so concurrent checkouts on one table can never reserve more than is open.
 */
export async function startCheckout(
  db: SqlClient,
  active: { provider: PaymentProvider; settings: PaymentSettings },
  input: CheckoutInput,
): Promise<{ paymentId: string; redirectUrl: string; charge: Charge }> {
  const { provider, settings } = active;
  const open = await openBillForTable(db, input.table.id);
  if (open && open.pending_agorot > 0) await releaseStaleCheckouts(db, active, open.id);
  const reserved = await db.transaction(async (tx) => {
    const [locked] = await tx.query<{ id: string }>(
      "SELECT id FROM bills WHERE table_id = $1 AND status = 'open' FOR UPDATE",
      [input.table.id],
    );
    if (!locked) throw notFound();
    const [bill] = await tx.query<BillRow>(`${BILL_SELECT} WHERE b.id = $1 GROUP BY b.id`, [locked.id]);
    const charge = computeCharge(totalsOf(bill!), input.share, input.tip, settings.tipPercents);
    if (typeof charge === 'string') throw new HttpError(charge === 'nothing_to_pay' ? 409 : 400, charge);
    const [payment] = await tx.query<{ id: string }>(
      `INSERT INTO payments (bill_id, share_agorot, tip_agorot, provider, mode) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [bill!.id, charge.share, charge.tip, provider.id, settings.mode],
    );
    return { paymentId: payment!.id, charge };
  });

  // A per-payment key in the receipt callback's URL: that callback is unsigned (see the receipt route).
  const receiptKey = provider.receiptCallback ? randomBytes(16).toString('hex') : null;
  try {
    const session = await provider.createSession({
      paymentId: reserved.paymentId,
      amountAgorot: reserved.charge.total,
      description: input.description,
      payer: input.payer,
      locale: input.locale,
      ...input.urls(reserved.paymentId, receiptKey),
    });
    const ref = receiptKey ? { ...session.ref, receiptKey } : session.ref;
    await db.query('UPDATE payments SET provider_ref = $2 WHERE id = $1', [reserved.paymentId, JSON.stringify(ref)]);
    return { paymentId: reserved.paymentId, redirectUrl: session.redirectUrl, charge: reserved.charge };
  } catch (err) {
    // Release the reservation: the guest can try again right away.
    await db.query("UPDATE payments SET status = 'failed' WHERE id = $1 AND status = 'pending'", [reserved.paymentId]);
    if (err instanceof ProviderError) throw new HttpError(502, 'provider_unavailable');
    throw err;
  }
}

// --- verification -----------------------------------------------------------------------------------

export interface PaymentRow {
  id: string;
  bill_id: string;
  share_agorot: number;
  tip_agorot: number;
  status: 'pending' | 'paid' | 'failed' | 'expired';
  review_reason: ReviewReason | null;
  provider: ProviderId;
  provider_ref: ProviderRef;
  created_at: Date;
  receipt_url: string | null;
}

const PAYMENT_COLUMNS = 'id, bill_id, share_agorot, tip_agorot, status, review_reason, provider, provider_ref, created_at, receipt_url';

export async function loadPayment(db: SqlClient, id: string): Promise<PaymentRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db.query<PaymentRow>(`SELECT ${PAYMENT_COLUMNS} FROM payments WHERE id = $1`, [id]);
  return row ?? null;
}

/** Keeps the first receipt reported for a payment (a later, different one is ignored). */
async function storeReceipt(db: SqlClient, paymentId: string, receipt: Receipt): Promise<boolean> {
  const rows = await db.query(
    'UPDATE payments SET receipt_number = $2, receipt_url = $3 WHERE id = $1 AND receipt_url IS NULL RETURNING 1',
    [paymentId, receipt.number, receipt.url],
  );
  return rows.length > 0;
}

async function event(db: SqlClient, paymentId: string | null, provider: string, kind: string, outcome: string) {
  await db.query('INSERT INTO payment_events (payment_id, provider, kind, outcome) VALUES ($1, $2, $3, $4)', [paymentId, provider, kind, outcome]);
}

export type VerifyOutcome = 'paid' | 'failed' | 'pending' | 'amount_mismatch';

/**
 * Why a confirmed payment needs a person: money was taken (so it is recorded as paid) but the bill
 * could no longer take it, e.g. a guest finished paying on the provider's page after the bill was
 * paid by someone else, closed or cancelled. Staff see it flagged for a refund or review.
 */
export type ReviewReason = 'bill_not_open' | 'overpaid';

/**
 * Asks the provider (server-to-server) what happened, and records it. Idempotent: verifying a paid
 * payment again changes nothing. A charge for a different amount than we asked for is never accepted.
 */
export async function verifyPayment(
  db: SqlClient,
  provider: PaymentProvider,
  payment: PaymentRow,
  kind: string,
  /** A status the provider already vouched for with a verified signature (see Notification.signedStatus). */
  known?: VerifiedStatus,
): Promise<VerifyOutcome> {
  if (payment.status === 'paid') return 'paid';
  if (payment.provider !== provider.id) return 'pending';
  const status = known ?? (await provider.fetchStatus(payment.provider_ref));
  const expected = payment.share_agorot + payment.tip_agorot;

  if (status.status === 'paid') {
    if (status.amountAgorot !== expected) {
      await event(db, payment.id, provider.id, kind, 'amount_mismatch');
      return 'amount_mismatch';
    }
    const marked = await db.transaction(async (tx) => {
      // Lock the bill first (same order as checkout), then flip the payment exactly once.
      const [bill] = await tx.query<{ status: string; amount_agorot: number; paid_other: number }>(
        `SELECT b.status, b.amount_agorot,
           (SELECT COALESCE(sum(share_agorot), 0)::int FROM payments WHERE bill_id = b.id AND status = 'paid' AND id <> $2) AS paid_other
         FROM bills b WHERE b.id = $1 FOR UPDATE`,
        [payment.bill_id, payment.id],
      );
      // Money was taken either way: record it as paid, and flag it when the bill can't take it.
      const review: ReviewReason | null =
        bill!.status !== 'open' ? 'bill_not_open' : bill!.paid_other + payment.share_agorot > bill!.amount_agorot ? 'overpaid' : null;
      // Refund handles join the stored identifiers (the ones we already have win).
      const [row] = await tx.query<{ id: string }>(
        `UPDATE payments SET status = 'paid', paid_at = now(), provider_txn = $2, review_reason = $3, provider_ref = $4::jsonb || provider_ref
         WHERE id = $1 AND status <> 'paid' RETURNING id`,
        [payment.id, status.transactionRef?.slice(0, 100) ?? null, review, JSON.stringify(status.refundRef ?? {})],
      );
      if (!row) return null;
      if (status.receipt) await storeReceipt(tx, payment.id, status.receipt);
      // Fully paid → the bill closes itself.
      await tx.query(
        `UPDATE bills SET status = 'paid', closed_at = now() WHERE id = $1 AND status = 'open'
           AND amount_agorot <= (SELECT COALESCE(sum(share_agorot), 0) FROM payments WHERE bill_id = $1 AND status = 'paid')`,
        [payment.bill_id],
      );
      await audit(tx, { userId: null, action: 'payment.paid', targetType: 'payment', targetId: payment.id, meta: { agorot: expected, provider: provider.id, review } });
      return { review };
    });
    await event(db, payment.id, provider.id, kind, !marked ? 'already_paid' : marked.review ? `paid_review_${marked.review}` : 'paid');
    return 'paid';
  }
  if (status.status === 'failed') {
    await db.query("UPDATE payments SET status = 'failed' WHERE id = $1 AND status = 'pending'", [payment.id]);
    await event(db, payment.id, provider.id, kind, 'failed');
    return 'failed';
  }
  return 'pending';
}

/**
 * Releases reservations older than RESERVATION_MINUTES. Each one is first checked with the provider,
 * so a payment that actually went through is recorded as paid rather than released. A charge that
 * still arrives later (the provider's page was left open) is recorded and flagged, never lost.
 * Network calls happen outside any row lock.
 */
export async function releaseStaleCheckouts(
  db: SqlClient,
  active: { provider: PaymentProvider } | null,
  billId?: string,
): Promise<number> {
  const stale = await db.query<PaymentRow>(
    `SELECT ${PAYMENT_COLUMNS} FROM payments
     WHERE status = 'pending' AND created_at < now() - make_interval(mins => ${RESERVATION_MINUTES})
       ${billId ? 'AND bill_id = $1' : ''} ORDER BY created_at LIMIT 50`,
    billId ? [billId] : [],
  );
  let released = 0;
  for (const payment of stale) {
    if (active && active.provider.id === payment.provider) {
      try {
        if ((await verifyPayment(db, active.provider, payment, 'release')) !== 'pending') continue;
      } catch {
        // Provider unreachable: release anyway; a late confirmation is still recorded and flagged.
      }
    }
    const [row] = await db.query("UPDATE payments SET status = 'expired' WHERE id = $1 AND status = 'pending' RETURNING 1", [payment.id]);
    if (row) {
      released++;
      await event(db, payment.id, payment.provider, 'release', 'expired');
    }
  }
  return released;
}

/**
 * Handles a provider's server-to-server notification. Unsigned notifications are only hints: the
 * payment must exist, match the notification's per-payment secret, and be confirmed by `fetchStatus`.
 */
export async function handleNotification(
  db: SqlClient,
  provider: PaymentProvider,
  body: unknown,
  findPayment: (n: Notification) => Promise<PaymentRow | null>,
  ctx?: NotificationContext,
): Promise<VerifyOutcome | 'ignored'> {
  const n = provider.parseNotification(body, ctx);
  if (!n) {
    await event(db, null, provider.id, 'notify', 'unparsable');
    return 'ignored';
  }
  const payment = await findPayment(n);
  if (!payment || payment.provider !== provider.id || !provider.matches(payment.provider_ref, n)) {
    await event(db, payment?.id ?? null, provider.id, 'notify', 'no_match');
    return 'ignored';
  }
  const outcome = await verifyPayment(db, provider, payment, 'notify', n.signedStatus);
  if (outcome === 'paid' && n.refundRef) {
    // The notification matched this payment's secret: keep its refund handles if we lack them.
    await db.query("UPDATE payments SET provider_ref = $2::jsonb || provider_ref WHERE id = $1 AND status = 'paid'", [payment.id, JSON.stringify(n.refundRef)]);
  }
  // A signed outcome can carry the receipt even when the payment was already confirmed another way.
  if (outcome === 'paid' && n.signedStatus?.receipt) await storeReceipt(db, payment.id, n.signedStatus.receipt);
  if (outcome === 'paid' && provider.acknowledge) {
    try {
      await provider.acknowledge(payment.provider_ref, n);
    } catch {
      // The payment is already recorded; the provider simply sends the update again later.
      await event(db, payment.id, provider.id, 'notify', 'ack_failed');
    }
  }
  return outcome;
}


/**
 * A provider's separate receipt callback (Grow's invoiceNotifyUrl). It is unsigned, so it counts only
 * when the URL's per-payment key matches (constant time), the body matches the stored identifiers,
 * and the provider's parser accepted the link. Returns what happened, for the event log.
 */
export async function handleReceipt(
  db: SqlClient,
  provider: PaymentProvider,
  paymentId: string,
  key: string,
  body: unknown,
): Promise<'stored' | 'duplicate' | 'ignored'> {
  const payment = await loadPayment(db, paymentId);
  const stored = payment?.provider === provider.id ? payment.provider_ref.receiptKey : undefined;
  const a = Buffer.from(stored ?? '');
  const b = Buffer.from(key);
  const parsed = provider.parseReceipt?.(body) ?? null;
  // Every identifier we hold must match, and at least one must be there to compare.
  const known = parsed && payment ? Object.entries(parsed.match).filter(([k]) => payment.provider_ref[k] !== undefined) : [];
  const ok =
    a.length > 0 && a.length === b.length && timingSafeEqual(a, b) && known.length > 0 &&
    known.every(([k, v]) => payment!.provider_ref[k] === v);
  if (!ok) {
    await event(db, payment && stored ? payment.id : null, provider.id, 'receipt', 'no_match');
    return 'ignored';
  }
  const fresh = await storeReceipt(db, payment!.id, parsed!.receipt);
  await event(db, payment!.id, provider.id, 'receipt', fresh ? 'stored' : 'duplicate');
  return fresh ? 'stored' : 'duplicate';
}
