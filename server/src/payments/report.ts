/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * Owner-only money views: the daily report (by the business's calendar days, with refunds on the day
 * they were made), its CSV export for accounting and tip sharing, and closing the loop on flagged payments. Nothing here contains payer
 * names, phones or card details: MenuAI never stores them.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { audit } from '../auth/service';
import { badRequest, conflict, HttpError, notFound } from '../errors';
import { agorotToDecimal } from './money';

/** Longest report range (about a quarter): keeps one request's work bounded. */
export const MAX_REPORT_DAYS = 92;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d));

function parseRange(req: FastifyRequest): { from: string; to: string } {
  const q = z.object({ from: dateSchema, to: dateSchema }).safeParse(req.query);
  if (!q.success) throw badRequest('invalid_range');
  const days = (Date.parse(q.data.to) - Date.parse(q.data.from)) / 86_400_000;
  if (days < 0 || days >= MAX_REPORT_DAYS) throw badRequest('invalid_range');
  return q.data;
}

/** Cell for a CSV opened in Excel: quoted, and never starting a formula (CSV injection). */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// Paid payments within [from, to] in the business's calendar ($1 = time zone, $2 = from, $3 = to).
const IN_RANGE = `p.status = 'paid'
  AND p.paid_at >= ($2::date)::timestamp AT TIME ZONE $1
  AND p.paid_at < ($3::date + 1)::timestamp AT TIME ZONE $1`;

export async function paymentReportRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;
  const owner = requireRole('owner');
  const configured = () => {
    if (!config.PAYMENTS_KEY) throw new HttpError(503, 'payments_not_configured');
  };
  const tz = config.BUSINESS_TIMEZONE;

  app.get('/api/payments/report', { preHandler: owner }, async (req) => {
    configured();
    const { from, to } = parseRange(req);
    const rows = await db.query<{ day: string; mode: string; bills: number; payments: number; collected: number; tips: number; open_reviews: number }>(
      `SELECT to_char((p.paid_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day, p.mode,
         count(DISTINCT p.bill_id)::int AS bills, count(*)::int AS payments,
         sum(p.share_agorot)::int AS collected, sum(p.tip_agorot)::int AS tips,
         (count(*) FILTER (WHERE p.review_reason IS NOT NULL AND p.review_resolved_at IS NULL))::int AS open_reviews
       FROM payments p WHERE ${IN_RANGE}
       GROUP BY 1, 2 ORDER BY 1, 2`,
      [tz, from, to],
    );
    // Refunds count on the day they were made, which can differ from the day of the charge.
    const refunds = await db.query<{ day: string; mode: string; refunded: number }>(
      `SELECT to_char((f.completed_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day, p.mode, sum(f.amount_agorot)::int AS refunded
       FROM payment_refunds f JOIN payments p ON p.id = f.payment_id
       WHERE f.status = 'succeeded'
         AND f.completed_at >= ($2::date)::timestamp AT TIME ZONE $1
         AND f.completed_at < ($3::date + 1)::timestamp AT TIME ZONE $1
       GROUP BY 1, 2`,
      [tz, from, to],
    );
    const days = new Map<string, { date: string; mode: string; bills: number; payments: number; collectedAgorot: number; tipsAgorot: number; refundedAgorot: number; openReviews: number }>();
    for (const r of rows) {
      days.set(`${r.day}|${r.mode}`, {
        date: r.day, mode: r.mode, bills: r.bills, payments: r.payments,
        collectedAgorot: r.collected, tipsAgorot: r.tips, refundedAgorot: 0, openReviews: r.open_reviews,
      });
    }
    for (const f of refunds) {
      const key = `${f.day}|${f.mode}`;
      const day = days.get(key) ?? { date: f.day, mode: f.mode, bills: 0, payments: 0, collectedAgorot: 0, tipsAgorot: 0, refundedAgorot: 0, openReviews: 0 };
      day.refundedAgorot = f.refunded;
      days.set(key, day);
    }
    return {
      timezone: tz,
      from,
      to,
      days: [...days.values()].sort((a, b) => (a.date === b.date ? a.mode.localeCompare(b.mode) : a.date.localeCompare(b.date))),
    };
  });

  app.get('/api/payments/report.csv', { preHandler: owner }, async (req, reply) => {
    configured();
    const { from, to } = parseRange(req);
    const rows = await db.query<{
      at: string; table_label: string; share_agorot: number; tip_agorot: number; provider: string; mode: string;
      provider_txn: string | null; review_reason: string | null; review_note: string | null; review_resolved_at: Date | null; refunded: number; receipt_number: string | null;
    }>(
      `SELECT to_char(p.paid_at AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS at, t.label AS table_label,
         p.share_agorot, p.tip_agorot, p.provider, p.mode, p.provider_txn, p.receipt_number, p.review_reason, p.review_note, p.review_resolved_at,
         (SELECT COALESCE(sum(f.amount_agorot), 0) FROM payment_refunds f WHERE f.payment_id = p.id AND f.status = 'succeeded')::int AS refunded
       FROM payments p JOIN bills b ON b.id = p.bill_id JOIN dining_tables t ON t.id = b.table_id
       WHERE ${IN_RANGE} ORDER BY p.paid_at
       LIMIT 50000`,
      [tz, from, to],
    );
    const header = ['paid_at', 'table', 'amount', 'tip', 'total', 'refunded', 'provider', 'mode', 'reference', 'receipt', 'review', 'review_note'];
    const lines = rows.map((r) =>
      [
        r.at, r.table_label, agorotToDecimal(r.share_agorot), agorotToDecimal(r.tip_agorot), agorotToDecimal(r.share_agorot + r.tip_agorot),
        agorotToDecimal(r.refunded), r.provider, r.mode, r.provider_txn, r.receipt_number, r.review_reason ? `${r.review_reason}${r.review_resolved_at ? ' (resolved)' : ''}` : '', r.review_note,
      ].map(csvCell).join(','),
    );
    // BOM so Excel opens Hebrew table names correctly; CRLF per RFC 4180.
    const body = `﻿${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
    await audit(db, { userId: req.user!.id, action: 'payments.export', targetType: 'payments', meta: { from, to, rows: rows.length } });
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="menuai-payments-${from}-to-${to}.csv"`)
      .send(body);
  });

  // The owner refunded a flagged payment in the provider's dashboard (or checked it): close the loop.
  app.post('/api/payments/payments/:id/resolve', { preHandler: owner }, async (req) => {
    configured();
    const id = z.uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) throw notFound();
    const body = z.object({ note: z.string().trim().min(1).max(200) }).strict().safeParse(req.body);
    if (!body.success) throw badRequest();
    const [row] = await db.query<{ id: string }>(
      `UPDATE payments SET review_resolved_at = now(), review_resolved_by = $2, review_note = $3
       WHERE id = $1 AND status = 'paid' AND review_reason IS NOT NULL AND review_resolved_at IS NULL RETURNING id`,
      [id.data, req.user!.id, body.data.note],
    );
    if (!row) {
      const [exists] = await db.query('SELECT 1 FROM payments WHERE id = $1', [id.data]);
      if (!exists) throw notFound();
      throw conflict('nothing_to_resolve');
    }
    await audit(db, { userId: req.user!.id, action: 'payment.review_resolved', targetType: 'payment', targetId: id.data });
    return { ok: true };
  });
}
