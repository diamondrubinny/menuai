/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { audit } from '../auth/service';
import { badRequest, conflict, HttpError, notFound } from '../errors';
import { availableProviders, modeAllowed } from './providers';
import { PROVIDER_IDS } from './providers/types';
import { activeProvider, BILL_SELECT, loadSettings, newTableToken, releaseStaleCheckouts, saveSettings, type BillRow } from './service';

const idSchema = z.uuid();
const amountSchema = z.number().int().min(100).max(10_000_000);
const labelSchema = z.string().trim().min(1).max(40);
const noteSchema = z.string().trim().max(200);

/** Credential field names each provider needs (values are write-only: the API never returns them). */
export const CREDENTIAL_FIELDS: Record<(typeof PROVIDER_IDS)[number], string[]> = {
  fake: [],
  grow: ['userId', 'pageCode'],
};

function parseId(req: FastifyRequest): string {
  const id = idSchema.safeParse((req.params as { id: string }).id);
  if (!id.success) throw notFound();
  return id.data;
}

/** Guest address of a table (its QR code): `https://menu.example.com/t/<token>`. */
export function tableUrl(publicBase: string, token: string): string {
  return new URL(`t/${token}`, publicBase.endsWith('/') ? publicBase : `${publicBase}/`).toString();
}

const billDto = (b: BillRow & { table_label?: string }) => ({
  id: b.id,
  tableId: b.table_id,
  tableLabel: b.table_label,
  amountAgorot: b.amount_agorot,
  paidAgorot: b.paid_agorot,
  pendingAgorot: b.pending_agorot,
  tipsAgorot: b.tips_agorot,
  note: b.note,
  status: b.status,
  openedAt: b.opened_at,
  closedAt: b.closed_at,
});

export async function paymentRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;
  const viewer = requireRole('viewer');
  const editor = requireRole('editor');
  const owner = requireRole('owner');
  const configured = () => {
    if (!config.PAYMENTS_KEY) throw new HttpError(503, 'payments_not_configured');
  };

  // What the editor needs to show the payments screen at all.
  app.get('/api/payments/status', { preHandler: viewer }, async () => {
    const settings = config.PAYMENTS_KEY ? await loadSettings(db, config) : null;
    const providers = availableProviders(config);
    return {
      configured: Boolean(config.PAYMENTS_KEY),
      providers,
      // On only when guests can really pay: enabled, available here, allowed mode, credentials present.
      enabled: Boolean(settings?.enabled && (await activeProvider(db, config, app.deps.paymentHttp))),
      provider: settings?.provider ?? null,
      mode: settings?.mode ?? null,
    };
  });

  app.get('/api/payments/settings', { preHandler: owner }, async () => {
    configured();
    const s = await loadSettings(db, config);
    return {
      settings: {
        enabled: s.enabled,
        provider: s.provider,
        mode: s.mode,
        tipPercents: s.tipPercents,
        termsUrl: s.termsUrl,
        hasCredentials: s.credentials !== null,
        updatedAt: s.updatedAt,
      },
      providers: availableProviders(config).map((id) => ({ id, credentialFields: CREDENTIAL_FIELDS[id], liveAllowed: modeAllowed(config, id, 'live') })),
    };
  });

  app.put('/api/payments/settings', { preHandler: owner, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    configured();
    const body = z
      .object({
        enabled: z.boolean(),
        provider: z.enum(PROVIDER_IDS),
        mode: z.enum(['test', 'live']),
        tipPercents: z.array(z.number().int().min(1).max(50)).max(5),
        termsUrl: z.url({ protocol: /^https$/ }).max(500).nullable().default(null),
        credentials: z.record(z.string().regex(/^[A-Za-z]{1,40}$/), z.string().trim().min(1).max(200)).nullable().optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!body.success) throw badRequest();
    const next = body.data;
    if (!availableProviders(config).includes(next.provider)) throw badRequest('provider_unavailable');
    if (next.provider === 'fake' && next.mode === 'live') throw badRequest('demo_is_test_only');
    if (!modeAllowed(config, next.provider, next.mode)) throw badRequest('live_not_enabled');
    if (next.credentials) {
      const fields = CREDENTIAL_FIELDS[next.provider];
      const keys = Object.keys(next.credentials);
      if (keys.length !== fields.length || !fields.every((f) => keys.includes(f))) throw badRequest('invalid_credentials');
    }
    const current = await loadSettings(db, config);
    const willHave = next.credentials === undefined ? current.credentials !== null && current.provider === next.provider : next.credentials !== null;
    if (next.enabled && CREDENTIAL_FIELDS[next.provider].length > 0 && !willHave) throw badRequest('credentials_required');
    const tipPercents = [...new Set(next.tipPercents)].sort((a, b) => a - b);
    await saveSettings(db, config, req.user!.id, {
      ...next,
      tipPercents,
      // Switching providers drops the old provider's keys unless new ones are given.
      credentials: next.credentials === undefined && current.provider !== next.provider ? null : next.credentials,
    });
    return { ok: true };
  });

  // --- tables ---------------------------------------------------------------------------------------

  app.get('/api/payments/tables', { preHandler: editor }, async () => {
    configured();
    const rows = await db.query<{ id: string; label: string; token: string; menu_id: string | null; active: boolean; open_bill: string | null }>(
      `SELECT t.id, t.label, t.token, t.menu_id, t.active, b.id AS open_bill
       FROM dining_tables t LEFT JOIN bills b ON b.table_id = t.id AND b.status = 'open'
       ORDER BY t.active DESC, length(t.label), t.label`,
    );
    return {
      tables: rows.map((t) => ({ id: t.id, label: t.label, menuId: t.menu_id, active: t.active, url: tableUrl(config.PUBLIC_URL, t.token), openBillId: t.open_bill })),
    };
  });

  app.post('/api/payments/tables', { preHandler: owner }, async (req, reply) => {
    configured();
    const body = z.object({ label: labelSchema, menuId: z.uuid().nullable().default(null) }).strict().safeParse(req.body);
    if (!body.success) throw badRequest();
    const [count] = await db.query<{ n: string }>('SELECT count(*) AS n FROM dining_tables');
    if (Number(count?.n ?? 0) >= 500) throw conflict('too_many_tables');
    if (body.data.menuId) {
      const [menu] = await db.query('SELECT 1 FROM menus WHERE id = $1', [body.data.menuId]);
      if (!menu) throw badRequest('unknown_menu');
    }
    try {
      const [row] = await db.query<{ id: string }>(
        'INSERT INTO dining_tables (label, token, menu_id) VALUES ($1, $2, $3) RETURNING id',
        [body.data.label, newTableToken(), body.data.menuId],
      );
      await audit(db, { userId: req.user!.id, action: 'table.create', targetType: 'table', targetId: row!.id });
      return reply.status(201).send({ id: row!.id });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('label_taken');
      throw err;
    }
  });

  app.patch('/api/payments/tables/:id', { preHandler: owner }, async (req) => {
    configured();
    const id = parseId(req);
    const body = z
      .object({ label: labelSchema.optional(), menuId: z.uuid().nullable().optional(), active: z.boolean().optional() })
      .strict()
      .safeParse(req.body);
    if (!body.success) throw badRequest();
    const { label, menuId, active } = body.data;
    if (menuId) {
      const [menu] = await db.query('SELECT 1 FROM menus WHERE id = $1', [menuId]);
      if (!menu) throw badRequest('unknown_menu');
    }
    try {
      const [row] = await db.query<{ id: string }>(
        `UPDATE dining_tables SET label = COALESCE($2, label),
           menu_id = CASE WHEN $3::boolean THEN $4::uuid ELSE menu_id END,
           active = COALESCE($5, active)
         WHERE id = $1 RETURNING id`,
        [id, label ?? null, menuId !== undefined, menuId ?? null, active ?? null],
      );
      if (!row) throw notFound();
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('label_taken');
      throw err;
    }
    await audit(db, { userId: req.user!.id, action: 'table.update', targetType: 'table', targetId: id, meta: { active } });
    return { ok: true };
  });

  // A new QR for the table (e.g. a printed code was photographed and shared). The old one stops working.
  app.post('/api/payments/tables/:id/rotate', { preHandler: owner }, async (req) => {
    configured();
    const id = parseId(req);
    const [row] = await db.query<{ token: string }>('UPDATE dining_tables SET token = $2 WHERE id = $1 RETURNING token', [id, newTableToken()]);
    if (!row) throw notFound();
    await audit(db, { userId: req.user!.id, action: 'table.rotate', targetType: 'table', targetId: id });
    return { url: tableUrl(config.PUBLIC_URL, row.token) };
  });

  // --- bills ----------------------------------------------------------------------------------------

  app.get('/api/payments/bills', { preHandler: editor }, async (req) => {
    configured();
    const q = z.object({ view: z.enum(['open', 'recent']).default('open') }).safeParse(req.query);
    if (!q.success) throw badRequest();
    // Abandoned checkouts stop showing as "being paid" (checked with the provider first).
    await releaseStaleCheckouts(db, await activeProvider(db, config, app.deps.paymentHttp));
    // "Open" also lists recent bills with money that needs a refund or review, so staff can't miss them.
    const where =
      q.data.view === 'open'
        ? `(b.status = 'open' OR EXISTS (SELECT 1 FROM payments r WHERE r.bill_id = b.id AND r.review_reason IS NOT NULL AND r.paid_at > now() - interval '2 days'))`
        : "b.opened_at > now() - interval '2 days'";
    const bills = await db.query<BillRow & { table_label: string }>(
      `SELECT x.*, t.label AS table_label FROM (${BILL_SELECT} WHERE ${where} GROUP BY b.id) x
       JOIN dining_tables t ON t.id = x.table_id ORDER BY x.opened_at DESC LIMIT 200`,
    );
    const ids = bills.map((b) => b.id);
    const payments = ids.length
      ? await db.query<{ id: string; bill_id: string; share_agorot: number; tip_agorot: number; status: string; review_reason: string | null; provider: string; mode: string; provider_txn: string | null; created_at: Date; paid_at: Date | null }>(
          `SELECT id, bill_id, share_agorot, tip_agorot, status, review_reason, provider, mode, provider_txn, created_at, paid_at
           FROM payments WHERE bill_id = ANY($1::uuid[]) ORDER BY created_at`,
          [ids],
        )
      : [];
    return {
      bills: bills.map((b) => ({
        ...billDto(b),
        payments: payments
          .filter((p) => p.bill_id === b.id)
          .map((p) => ({
            id: p.id, shareAgorot: p.share_agorot, tipAgorot: p.tip_agorot, status: p.status, reviewReason: p.review_reason, provider: p.provider,
            mode: p.mode, transactionRef: p.provider_txn, createdAt: p.created_at, paidAt: p.paid_at,
          })),
      })),
    };
  });

  app.post('/api/payments/bills', { preHandler: editor }, async (req, reply) => {
    configured();
    const body = z.object({ tableId: z.uuid(), amountAgorot: amountSchema, note: noteSchema.default('') }).strict().safeParse(req.body);
    if (!body.success) throw badRequest();
    const [table] = await db.query('SELECT 1 FROM dining_tables WHERE id = $1 AND active', [body.data.tableId]);
    if (!table) throw badRequest('unknown_table');
    try {
      const [row] = await db.query<{ id: string }>(
        'INSERT INTO bills (table_id, amount_agorot, note, opened_by) VALUES ($1, $2, $3, $4) RETURNING id',
        [body.data.tableId, body.data.amountAgorot, body.data.note, req.user!.id],
      );
      await audit(db, { userId: req.user!.id, action: 'bill.open', targetType: 'bill', targetId: row!.id, meta: { agorot: body.data.amountAgorot } });
      return reply.status(201).send({ id: row!.id });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('bill_already_open');
      throw err;
    }
  });

  app.patch('/api/payments/bills/:id', { preHandler: editor }, async (req) => {
    configured();
    const id = parseId(req);
    const body = z.object({ amountAgorot: amountSchema.optional(), note: noteSchema.optional() }).strict().safeParse(req.body);
    if (!body.success) throw badRequest();
    await releaseStaleCheckouts(db, await activeProvider(db, config, app.deps.paymentHttp), id);
    await db.transaction(async (tx) => {
      const [locked] = await tx.query<{ status: string }>('SELECT status FROM bills WHERE id = $1 FOR UPDATE', [id]);
      if (!locked) throw notFound();
      if (locked.status !== 'open') throw conflict('bill_not_open');
      const [bill] = await tx.query<BillRow>(`${BILL_SELECT} WHERE b.id = $1 GROUP BY b.id`, [id]);
      const amount = body.data.amountAgorot;
      // Can't go below what is paid or being paid right now.
      if (amount !== undefined && amount < bill!.paid_agorot + bill!.pending_agorot) throw conflict('amount_below_paid');
      await tx.query(
        `UPDATE bills SET amount_agorot = COALESCE($2, amount_agorot), note = COALESCE($3, note),
           status = CASE WHEN COALESCE($2, amount_agorot) <= $4 THEN 'paid'::bill_status ELSE status END,
           closed_at = CASE WHEN COALESCE($2, amount_agorot) <= $4 THEN now() ELSE closed_at END
         WHERE id = $1`,
        [id, amount ?? null, body.data.note ?? null, bill!.paid_agorot],
      );
      await audit(tx, { userId: req.user!.id, action: 'bill.update', targetType: 'bill', targetId: id, meta: { agorot: amount } });
    });
    return { ok: true };
  });

  // Paid some other way (cash, card at the counter): closes the bill for guests.
  app.post('/api/payments/bills/:id/close', { preHandler: editor }, async (req) => {
    configured();
    const id = parseId(req);
    const [row] = await db.query<{ id: string }>(
      "UPDATE bills SET status = 'closed', closed_at = now() WHERE id = $1 AND status = 'open' RETURNING id",
      [id],
    );
    if (!row) throw conflict('bill_not_open');
    await audit(db, { userId: req.user!.id, action: 'bill.close', targetType: 'bill', targetId: id });
    return { ok: true };
  });

  // Opened by mistake. Only while nothing was paid on it.
  app.post('/api/payments/bills/:id/cancel', { preHandler: editor }, async (req) => {
    configured();
    const id = parseId(req);
    await releaseStaleCheckouts(db, await activeProvider(db, config, app.deps.paymentHttp), id);
    await db.transaction(async (tx) => {
      // Lock the bill: a checkout starting right now waits, then sees the bill is no longer open.
      const [bill] = await tx.query<{ status: string }>('SELECT status FROM bills WHERE id = $1 FOR UPDATE', [id]);
      if (!bill) throw notFound();
      if (bill.status !== 'open') throw conflict('bill_not_open');
      const [busy] = await tx.query("SELECT 1 FROM payments WHERE bill_id = $1 AND status IN ('paid', 'pending') LIMIT 1", [id]);
      if (busy) throw conflict('bill_has_payments');
      await tx.query("UPDATE bills SET status = 'cancelled', closed_at = now() WHERE id = $1", [id]);
      await audit(tx, { userId: req.user!.id, action: 'bill.cancel', targetType: 'bill', targetId: id });
    });
    return { ok: true };
  });
}
