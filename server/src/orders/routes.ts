/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * Ordering routes.
 * - Guests (no account): GET/POST /t/<table code>/order, from the published menu's cart (tablePay.js).
 *   The table code is the key; requests are rate limited and never logged with it (see safeUrl).
 *   POST needs our own Origin (the global CSRF check), which the published menu at /m/… has.
 * - Staff: the orders list and accept / reject (editor), turning ordering on or off (owner).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { audit } from '../auth/service';
import { badRequest, HttpError, notFound } from '../errors';
import { tableByToken } from '../payments/service';
import {
  acceptOrder, liveMenu, localized, orderableItems, orderingEnabled, orderRequestSchema, placeOrder, recentTableOrders, rejectOrder, toAgorot,
} from './service';

const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store');

export async function orderRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;
  const editor = requireRole('editor');
  const owner = requireRole('owner');
  const configured = () => {
    if (!config.PAYMENTS_KEY) throw new HttpError(503, 'payments_not_configured');
  };
  const guest = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } }, logLevel: 'warn' as const });

  // --- guests ---------------------------------------------------------------------------------------

  // What can be ordered at this table (names in the guest's language, prices from the live menu), and
  // the table's recent orders with their status.
  // Per IP: a restaurant's tablets often share one public IP, so these are generous; the per-table
  // limit (waiting orders) is what stops a leaked QR.
  app.get('/t/:token/order', guest(300), async (req, reply) => {
    noStore(reply);
    const table = config.PAYMENTS_KEY ? await tableByToken(db, (req.params as { token: string }).token) : null;
    if (!table) throw notFound();
    const live = (await orderingEnabled(db)) ? await liveMenu(db, table.menuId) : null;
    if (!live) return { enabled: false, items: {}, orders: [] };
    const q = z.object({ lang: z.string().regex(/^[a-z]{2,3}$/).optional() }).safeParse(req.query);
    const lang = q.success && q.data.lang && live.menu.locales.includes(q.data.lang) ? q.data.lang : live.menu.defaultLocale;
    const items: Record<string, { name: string; price?: number; variants?: { id: string; label: string; price: number }[] }> = {};
    for (const item of orderableItems(live.menu).values()) {
      if (item.soldOut) continue;
      const name = localized(item.name, lang, live.menu.defaultLocale);
      if (item.variants.length > 0) {
        items[item.id] = { name, variants: item.variants.map((v) => ({ id: v.id, label: localized(v.label, lang, live.menu.defaultLocale), price: toAgorot(v.price) })) };
      } else if (item.price !== undefined) {
        items[item.id] = { name, price: toAgorot(item.price) };
      }
    }
    return { enabled: true, items, orders: await recentTableOrders(db, table.id) };
  });

  app.post('/t/:token/order', guest(30), async (req, reply) => {
    noStore(reply);
    const table = config.PAYMENTS_KEY ? await tableByToken(db, (req.params as { token: string }).token) : null;
    if (!table) throw notFound();
    if (!(await orderingEnabled(db))) throw new HttpError(409, 'ordering_unavailable');
    const body = orderRequestSchema.safeParse(req.body);
    if (!body.success) throw badRequest('invalid_order');
    const result = await placeOrder(db, table, body.data);
    return reply.status(result.created ? 201 : 200).send({ id: result.id, totalAgorot: result.totalAgorot });
  });

  // --- staff ----------------------------------------------------------------------------------------

  app.get('/api/orders', { preHandler: editor }, async (req) => {
    configured();
    const q = z.object({ view: z.enum(['open', 'recent']).default('open') }).safeParse(req.query);
    if (!q.success) throw badRequest();
    const where = q.data.view === 'open' ? "o.status = 'new'" : "o.created_at > now() - interval '12 hours'";
    const orders = await db.query<{
      id: string; status: string; total_agorot: number; reject_reason: string | null; created_at: Date; decided_at: Date | null;
      table_id: string; table_label: string; bill_id: string | null;
    }>(
      `SELECT o.id, o.status, o.total_agorot, o.reject_reason, o.created_at, o.decided_at, o.table_id, t.label AS table_label, o.bill_id
       FROM orders o JOIN dining_tables t ON t.id = o.table_id WHERE ${where} ORDER BY o.created_at DESC LIMIT 100`,
    );
    const ids = orders.map((o) => o.id);
    const lines = ids.length
      ? await db.query<{ order_id: string; name: string; variant_label: string | null; unit_agorot: number; qty: number; note: string }>(
          'SELECT order_id, name, variant_label, unit_agorot, qty, note FROM order_lines WHERE order_id = ANY($1::uuid[]) ORDER BY order_id, position',
          [ids],
        )
      : [];
    return {
      enabled: await orderingEnabled(db),
      orders: orders.map((o) => ({
        id: o.id, status: o.status, totalAgorot: o.total_agorot, rejectReason: o.reject_reason, createdAt: o.created_at, decidedAt: o.decided_at,
        tableId: o.table_id, tableLabel: o.table_label, billId: o.bill_id,
        lines: lines.filter((l) => l.order_id === o.id).map((l) => ({ name: l.name, variantLabel: l.variant_label, unitAgorot: l.unit_agorot, qty: l.qty, note: l.note })),
      })),
    };
  });

  const orderId = (params: unknown) => {
    const id = z.uuid().safeParse((params as { id: string }).id);
    if (!id.success) throw notFound();
    return id.data;
  };

  app.post('/api/orders/:id/accept', { preHandler: editor }, async (req) => {
    configured();
    return { ok: true, ...(await acceptOrder(db, orderId(req.params), req.user!.id)) };
  });

  app.post('/api/orders/:id/reject', { preHandler: editor }, async (req) => {
    configured();
    const id = orderId(req.params);
    const body = z.object({ reason: z.string().trim().max(140).default('') }).strict().safeParse(req.body ?? {});
    if (!body.success) throw badRequest();
    await rejectOrder(db, id, req.user!.id, body.data.reason);
    return { ok: true };
  });

  app.put('/api/orders/settings', { preHandler: owner }, async (req) => {
    configured();
    const body = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
    if (!body.success) throw badRequest();
    await db.query(
      `INSERT INTO payment_settings (id, ordering_enabled, updated_by, updated_at) VALUES (1, $1, $2, now())
       ON CONFLICT (id) DO UPDATE SET ordering_enabled = $1, updated_by = $2, updated_at = now()`,
      [body.data.enabled, req.user!.id],
    );
    await audit(db, { userId: req.user!.id, action: 'orders.settings', targetType: 'orders', meta: { enabled: body.data.enabled } });
    return { ok: true };
  });
}
