/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { randomBytes } from 'node:crypto';
import type { Config } from '../config';
import type { SqlClient } from '../db/sql';
import { audit } from '../auth/service';
import { HttpError, notFound } from '../errors';
import { computeCharge, type BillTotals, type Charge, type ShareChoice, type TipChoice } from './money';
import { open, seal } from './crypto';
import { createProvider } from './providers';
import { ProviderError, type Notification, type Payer, type PaymentMode, type PaymentProvider, type ProviderId, type ProviderRef } from './providers/types';

/** A checkout reserves its share this long, so two guests can't both pay the whole bill at once. */
export const RESERVATION_MINUTES = 20;

// --- settings ---------------------------------------------------------------------------------------

export interface PaymentSettings {
  enabled: boolean;
  provider: ProviderId;
  mode: PaymentMode;
  credentials: Record<string, string> | null;
  tipPercents: number[];
  updatedAt: Date | null;
}

interface SettingsRow {
  enabled: boolean;
  provider: ProviderId;
  mode: PaymentMode;
  credentials_enc: string | null;
  tip_percents: number[];
  updated_at: Date;
}

export const DEFAULT_SETTINGS: PaymentSettings = {
  enabled: false, provider: 'fake', mode: 'test', credentials: null, tipPercents: [10, 12, 15], updatedAt: null,
};

export async function loadSettings(db: SqlClient, config: Config): Promise<PaymentSettings> {
  const [row] = await db.query<SettingsRow>(
    'SELECT enabled, provider, mode, credentials_enc, tip_percents, updated_at FROM payment_settings WHERE id = 1',
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
    updatedAt: row.updated_at,
  };
}

export async function saveSettings(
  db: SqlClient,
  config: Config,
  userId: string,
  next: { enabled: boolean; provider: ProviderId; mode: PaymentMode; tipPercents: number[]; credentials?: Record<string, string> | null },
): Promise<void> {
  if (!config.PAYMENTS_KEY) throw new HttpError(503, 'payments_not_configured');
  // undefined = keep the stored credentials; null = remove them; object = replace them.
  const credentialsSql = next.credentials === undefined ? 'payment_settings.credentials_enc' : '$5';
  const sealed = next.credentials ? seal(JSON.stringify(next.credentials), config.PAYMENTS_KEY) : null;
  await db.query(
    `INSERT INTO payment_settings (id, enabled, provider, mode, credentials_enc, tip_percents, updated_by, updated_at)
     VALUES (1, $1, $2, $3, $5, $4, $6, now())
     ON CONFLICT (id) DO UPDATE SET enabled = $1, provider = $2, mode = $3, tip_percents = $4,
       credentials_enc = ${credentialsSql}, updated_by = $6, updated_at = now()`,
    [next.enabled, next.provider, next.mode, next.tipPercents, sealed, userId],
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
export async function activeProvider(db: SqlClient, config: Config): Promise<{ provider: PaymentProvider; settings: PaymentSettings } | null> {
  if (!config.PAYMENTS_KEY) return null;
  const settings = await loadSettings(db, config);
  if (!settings.enabled) return null;
  const provider = createProvider(config, settings);
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
    COALESCE(sum(p.share_agorot) FILTER (WHERE p.status = 'pending' AND p.created_at > now() - make_interval(mins => ${RESERVATION_MINUTES})), 0)::int AS pending_agorot,
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
  /** Builds the guest-facing return URLs for a payment id. */
  urls: (paymentId: string) => { successUrl: string; cancelUrl: string; notifyUrl: string };
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

  try {
    const session = await provider.createSession({
      paymentId: reserved.paymentId,
      amountAgorot: reserved.charge.total,
      description: input.description,
      payer: input.payer,
      locale: input.locale,
      ...input.urls(reserved.paymentId),
    });
    await db.query('UPDATE payments SET provider_ref = $2 WHERE id = $1', [reserved.paymentId, JSON.stringify(session.ref)]);
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
  provider: ProviderId;
  provider_ref: ProviderRef;
  created_at: Date;
}

export async function loadPayment(db: SqlClient, id: string): Promise<PaymentRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.query<PaymentRow>(
    'SELECT id, bill_id, share_agorot, tip_agorot, status, provider, provider_ref, created_at FROM payments WHERE id = $1',
    [id],
  );
  return row ?? null;
}

async function event(db: SqlClient, paymentId: string | null, provider: string, kind: string, outcome: string) {
  await db.query('INSERT INTO payment_events (payment_id, provider, kind, outcome) VALUES ($1, $2, $3, $4)', [paymentId, provider, kind, outcome]);
}

export type VerifyOutcome = 'paid' | 'failed' | 'pending' | 'amount_mismatch';

/**
 * Asks the provider (server-to-server) what happened, and records it. Idempotent: verifying a paid
 * payment again changes nothing. A charge for a different amount than we asked for is never accepted.
 */
export async function verifyPayment(db: SqlClient, provider: PaymentProvider, payment: PaymentRow, kind: string): Promise<VerifyOutcome> {
  if (payment.status === 'paid') return 'paid';
  if (payment.provider !== provider.id) return 'pending';
  const status = await provider.fetchStatus(payment.provider_ref);
  const expected = payment.share_agorot + payment.tip_agorot;

  if (status.status === 'paid') {
    if (status.amountAgorot !== expected) {
      await event(db, payment.id, provider.id, kind, 'amount_mismatch');
      return 'amount_mismatch';
    }
    const marked = await db.transaction(async (tx) => {
      // Lock the bill first (same order as checkout), then flip the payment exactly once.
      await tx.query('SELECT 1 FROM bills WHERE id = $1 FOR UPDATE', [payment.bill_id]);
      const [row] = await tx.query<{ id: string }>(
        "UPDATE payments SET status = 'paid', paid_at = now(), provider_txn = $2 WHERE id = $1 AND status <> 'paid' RETURNING id",
        [payment.id, status.transactionRef?.slice(0, 100) ?? null],
      );
      if (!row) return false;
      // Fully paid → the bill closes itself.
      await tx.query(
        `UPDATE bills SET status = 'paid', closed_at = now() WHERE id = $1 AND status = 'open'
           AND amount_agorot <= (SELECT COALESCE(sum(share_agorot), 0) FROM payments WHERE bill_id = $1 AND status = 'paid')`,
        [payment.bill_id],
      );
      await audit(tx, { userId: null, action: 'payment.paid', targetType: 'payment', targetId: payment.id, meta: { agorot: expected, provider: provider.id } });
      return true;
    });
    await event(db, payment.id, provider.id, kind, marked ? 'paid' : 'already_paid');
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
 * Handles a provider's server-to-server notification. Unsigned notifications are only hints: the
 * payment must exist, match the notification's per-payment secret, and be confirmed by `fetchStatus`.
 */
export async function handleNotification(
  db: SqlClient,
  provider: PaymentProvider,
  body: unknown,
  findPayment: (n: Notification) => Promise<PaymentRow | null>,
): Promise<VerifyOutcome | 'ignored'> {
  const n = provider.parseNotification(body);
  if (!n) {
    await event(db, null, provider.id, 'notify', 'unparsable');
    return 'ignored';
  }
  const payment = await findPayment(n);
  if (!payment || payment.provider !== provider.id || !provider.matches(payment.provider_ref, n)) {
    await event(db, payment?.id ?? null, provider.id, 'notify', 'no_match');
    return 'ignored';
  }
  const outcome = await verifyPayment(db, provider, payment, 'notify');
  if (outcome === 'paid' && provider.acknowledge) await provider.acknowledge(payment.provider_ref, n);
  return outcome;
}

