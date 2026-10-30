/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * Refunds through the provider's API (owner only).
 *
 * Money rules:
 * - Never more than was charged (share + tip) minus refunds that succeeded.
 * - One refund in flight per payment (row lock + a partial unique index): two at once could refund twice.
 * - The provider is called outside any lock. If the call fails in transit the outcome is `unknown`:
 *   it is never retried automatically, and further refunds wait until the owner has checked the
 *   provider's dashboard and confirmed what happened.
 * - A refund goes through the provider and mode the payment was made with, never another one.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { audit } from '../auth/service';
import type { Config } from '../config';
import type { SqlClient } from '../db/sql';
import { badRequest, conflict, HttpError, notFound } from '../errors';
import { ProviderError, type PaymentProvider, type ProviderRef } from './providers/types';
import { configuredProvider, type PaymentSettings } from './service';

export type RefundStatus = 'pending' | 'succeeded' | 'failed' | 'unknown';

/** A `pending` refund older than this was interrupted (e.g. a restart mid-call): treat it as unknown. */
export const STUCK_REFUND_MINUTES = 2;

export interface RefundRow {
  id: string;
  payment_id: string;
  amount_agorot: number;
  status: RefundStatus;
  provider_refund_ref: string | null;
  error_code: string | null;
  note: string;
  created_at: Date;
  completed_at: Date | null;
}

export const REFUND_COLUMNS = 'id, payment_id, amount_agorot, status, provider_refund_ref, error_code, note, created_at, completed_at';

export const refundDto = (r: RefundRow) => ({
  id: r.id,
  amountAgorot: r.amount_agorot,
  status: r.status,
  // Interrupted calls read as "unknown" to staff: same handling (check the dashboard, then confirm).
  needsConfirmation: r.status === 'unknown' || (r.status === 'pending' && Date.now() - new Date(r.created_at).getTime() > STUCK_REFUND_MINUTES * 60_000),
  refundRef: r.provider_refund_ref,
  errorCode: r.error_code,
  note: r.note,
  createdAt: r.created_at,
  completedAt: r.completed_at,
});

/** Which payments can be refunded from here right now: the configured provider, if it supports refunds. */
export function refundChannel(active: { provider: PaymentProvider; settings: PaymentSettings } | null) {
  if (!active?.provider.refund) return null;
  return { provider: active.provider.id, mode: active.settings.mode, ...active.provider.refundPolicy };
}

/** Short, PII-free error code from a provider error (our own messages never carry request data). */
const errorCode = (err: unknown) => (err instanceof ProviderError ? err.message : 'internal').slice(0, 80);

export async function refundPayment(
  db: SqlClient,
  active: { provider: PaymentProvider; settings: PaymentSettings } | null,
  input: { paymentId: string; amountAgorot: number; note: string; userId: string; timezone: string },
): Promise<{ refundId: string; status: Exclude<RefundStatus, 'pending'>; refundRef: string | null }> {
  const provider = active?.provider;
  if (!active || !provider?.refund) throw conflict('refunds_unavailable');

  const prepared = await db.transaction(async (tx) => {
    const [p] = await tx.query<{
      status: string; provider: string; mode: string; share_agorot: number; tip_agorot: number; provider_ref: ProviderRef;
      review_reason: string | null; review_resolved_at: Date | null; same_day: boolean;
    }>(
      `SELECT status, provider, mode, share_agorot, tip_agorot, provider_ref, review_reason, review_resolved_at,
         (paid_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date AS same_day
       FROM payments WHERE id = $1 FOR UPDATE`,
      [input.paymentId, input.timezone],
    );
    if (!p) throw notFound();
    if (p.status !== 'paid') throw conflict('payment_not_paid');
    // Another provider / mode / account now: refund in that provider's dashboard and mark it handled.
    if (p.provider !== provider.id || p.mode !== active.settings.mode) throw conflict('refund_provider_changed');
    if (provider.refundable && !provider.refundable(p.provider_ref)) throw conflict('refund_reference_missing');

    const [sums] = await tx.query<{ refunded: number; open: number; done: number }>(
      `SELECT COALESCE(sum(amount_agorot) FILTER (WHERE status = 'succeeded'), 0)::int AS refunded,
         (count(*) FILTER (WHERE status IN ('pending', 'unknown')))::int AS open,
         (count(*) FILTER (WHERE status = 'succeeded'))::int AS done
       FROM payment_refunds WHERE payment_id = $1`,
      [input.paymentId],
    );
    const total = p.share_agorot + p.tip_agorot;
    if (sums!.open > 0) throw conflict('refund_in_progress');
    if (input.amountAgorot > total - sums!.refunded) throw conflict('refund_too_large');
    const policy = provider.refundPolicy;
    if (policy?.maxRefunds !== undefined && sums!.done >= policy.maxRefunds) throw conflict('refund_limit');
    if (policy && !policy.partialSameDay && p.same_day && (sums!.refunded > 0 || input.amountAgorot !== total)) {
      throw conflict('refund_partial_same_day');
    }

    const [row] = await tx.query<{ id: string }>(
      'INSERT INTO payment_refunds (payment_id, amount_agorot, note, requested_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [input.paymentId, input.amountAgorot, input.note, input.userId],
    );
    await audit(tx, {
      userId: input.userId, action: 'payment.refund_requested', targetType: 'payment', targetId: input.paymentId,
      meta: { refund: row!.id, agorot: input.amountAgorot, provider: provider.id },
    });
    return { refundId: row!.id, ref: p.provider_ref, total, refundedBefore: sums!.refunded, review: p.review_reason && !p.review_resolved_at };
  });

  let status: 'succeeded' | 'failed' | 'unknown';
  let refundRef: string | null = null;
  let code: string | null = null;
  try {
    const result = await provider.refund(prepared.ref, { amountAgorot: input.amountAgorot, refundId: prepared.refundId });
    status = 'succeeded';
    refundRef = result.refundRef?.slice(0, 100) ?? null;
  } catch (err) {
    // Refused → failed. Anything else (network, timeout, 5xx, a bug): it may have happened → unknown.
    status = err instanceof ProviderError && !err.retryable ? 'failed' : 'unknown';
    code = errorCode(err);
  }

  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE payment_refunds SET status = $2, provider_refund_ref = $3, error_code = $4,
         completed_at = CASE WHEN $2 = 'unknown' THEN NULL ELSE now() END
       WHERE id = $1 AND status = 'pending'`,
      [prepared.refundId, status, refundRef, code],
    );
    await audit(tx, {
      userId: input.userId, action: `payment.refund_${status}`, targetType: 'payment', targetId: input.paymentId,
      meta: { refund: prepared.refundId, agorot: input.amountAgorot, ...(code ? { error: code } : {}) },
    });
    if (status === 'succeeded') await resolveIfFullyRefunded(tx, input.paymentId, input.userId);
  });
  return { refundId: prepared.refundId, status, refundRef };
}

/** A flagged payment that has been refunded in full needs nothing more from anyone. */
async function resolveIfFullyRefunded(tx: SqlClient, paymentId: string, userId: string) {
  await tx.query(
    `UPDATE payments SET review_resolved_at = now(), review_resolved_by = $2, review_note = 'refunded'
     WHERE id = $1 AND review_reason IS NOT NULL AND review_resolved_at IS NULL
       AND share_agorot + tip_agorot <= (SELECT COALESCE(sum(amount_agorot), 0) FROM payment_refunds WHERE payment_id = $1 AND status = 'succeeded')`,
    [paymentId, userId],
  );
}

/**
 * The owner checked the provider's dashboard for a refund whose outcome was unknown (or that was
 * interrupted) and records what really happened.
 */
export async function confirmRefund(
  db: SqlClient,
  input: { refundId: string; outcome: 'succeeded' | 'failed'; userId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.query<{ payment_id: string; amount_agorot: number }>(
      `UPDATE payment_refunds SET status = $2, completed_at = now(), confirmed_by = $3
       WHERE id = $1 AND (status = 'unknown' OR (status = 'pending' AND created_at < now() - make_interval(mins => ${STUCK_REFUND_MINUTES})))
       RETURNING payment_id, amount_agorot`,
      [input.refundId, input.outcome, input.userId],
    );
    if (!row) {
      const [exists] = await tx.query('SELECT 1 FROM payment_refunds WHERE id = $1', [input.refundId]);
      if (!exists) throw notFound();
      throw conflict('nothing_to_confirm');
    }
    await audit(tx, {
      userId: input.userId, action: 'payment.refund_confirmed', targetType: 'payment', targetId: row.payment_id,
      meta: { refund: input.refundId, outcome: input.outcome, agorot: row.amount_agorot },
    });
    if (input.outcome === 'succeeded') await resolveIfFullyRefunded(tx, row.payment_id, input.userId);
  });
}

export async function paymentRefundRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;
  const owner = requireRole('owner');
  const configured = (c: Config) => {
    if (!c.PAYMENTS_KEY) throw new HttpError(503, 'payments_not_configured');
  };
  const parseUuid = (v: unknown) => {
    const id = z.uuid().safeParse(v);
    if (!id.success) throw notFound();
    return id.data;
  };

  app.post(
    '/api/payments/payments/:id/refund',
    { preHandler: owner, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      configured(config);
      const paymentId = parseUuid((req.params as { id: string }).id);
      const body = z
        .object({ amountAgorot: z.number().int().min(1).max(10_000_000), note: z.string().trim().max(200).default('') })
        .strict()
        .safeParse(req.body);
      if (!body.success) throw badRequest();
      // Refunds use the configured provider even while guests can't pay (payments switched off).
      const active = await configuredProvider(db, config, app.deps.paymentHttp);
      return refundPayment(db, active, { paymentId, ...body.data, userId: req.user!.id, timezone: config.BUSINESS_TIMEZONE });
    },
  );

  app.post('/api/payments/refunds/:id/confirm', { preHandler: owner }, async (req) => {
    configured(config);
    const refundId = parseUuid((req.params as { id: string }).id);
    const body = z.object({ outcome: z.enum(['succeeded', 'failed']) }).strict().safeParse(req.body);
    if (!body.success) throw badRequest();
    await confirmRefund(db, { refundId, outcome: body.data.outcome, userId: req.user!.id });
    return { ok: true };
  });
}
