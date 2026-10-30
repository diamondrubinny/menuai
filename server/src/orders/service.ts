/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * Ordering from the published menu (Phase 3e, flow B).
 *
 * Money rules:
 * - Prices never come from the browser. They are computed here, in agorot, from the menu's **live
 *   published version**: an item must be there, visible, not sold out and priced.
 * - Nothing is charged by ordering. A waiter accepts an order, and only then is its total added to the
 *   table's bill (under the bill row lock, like checkout), which guests pay through the usual flow.
 */
import { z } from 'zod';
import { parseMenu, type Item, type Localized, type Menu } from '../../../src/core/schema';
import { audit } from '../auth/service';
import type { SqlClient } from '../db/sql';
import { conflict, HttpError, notFound } from '../errors';

export const ORDER_LIMITS = {
  lines: 30,
  qty: 20,
  note: 140,
  /** Orders waiting for a waiter per table: more is spam from a leaked QR, not a dinner. */
  openPerTable: 5,
  /** A bill can't hold more than this (bills.amount_agorot check). */
  billMaxAgorot: 10_000_000,
  minAgorot: 100,
} as const;

export const orderLineSchema = z
  .object({
    itemId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    variantId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
    qty: z.number().int().min(1).max(ORDER_LIMITS.qty),
    // Plain text only; control characters removed. Shown escaped everywhere.
    note: z.string().max(ORDER_LIMITS.note).transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).optional(),
  })
  .strict();

export const orderRequestSchema = z
  .object({
    /** Client-generated per order: a double tap or a retried request creates one order. */
    key: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
    lang: z.string().regex(/^[a-z]{2,3}$/).optional(),
    lines: z.array(orderLineSchema).min(1).max(ORDER_LIMITS.lines),
  })
  .strict();

export type OrderRequest = z.infer<typeof orderRequestSchema>;

export interface PricedLine {
  itemId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  unitAgorot: number;
  qty: number;
  note: string;
}

export type PriceError = 'unknown_item' | 'unavailable_item' | 'variant_required' | 'unknown_variant' | 'no_price' | 'too_small';

/** Shekels as the menu stores them (e.g. 42.5) → agorot, rounded once. */
export const toAgorot = (shekels: number) => Math.round(shekels * 100);

export function localized(text: Localized | undefined, locale: string, fallback: string): string {
  if (!text) return '';
  return text[locale] || text[fallback] || Object.values(text).find(Boolean) || '';
}

/** Visible, orderable items of a menu by id (hidden sections and items are not on the guest's menu). */
export function orderableItems(menu: Menu): Map<string, Item> {
  const items = new Map<string, Item>();
  for (const section of menu.sections) {
    if (section.hidden) continue;
    for (const item of section.items) if (!item.hidden) items.set(item.id, item);
  }
  return items;
}

/** Prices an order from the published menu. Returns the lines with server-side prices, or why not. */
export function priceOrder(menu: Menu, lines: OrderRequest['lines'], locale: string): { lines: PricedLine[]; total: number } | PriceError {
  const items = orderableItems(menu);
  const priced: PricedLine[] = [];
  for (const line of lines) {
    const item = items.get(line.itemId);
    if (!item) return 'unknown_item';
    if (item.soldOut) return 'unavailable_item';
    let unit: number | undefined;
    let variantLabel: string | null = null;
    if (item.variants.length > 0) {
      if (!line.variantId) return 'variant_required';
      const variant = item.variants.find((v) => v.id === line.variantId);
      if (!variant) return 'unknown_variant';
      unit = variant.price;
      variantLabel = localized(variant.label, locale, menu.defaultLocale).slice(0, 100) || null;
    } else {
      if (line.variantId) return 'unknown_variant';
      unit = item.price;
    }
    if (unit === undefined) return 'no_price';
    priced.push({
      itemId: item.id,
      variantId: line.variantId ?? null,
      name: localized(item.name, locale, menu.defaultLocale).slice(0, 200) || item.id,
      variantLabel,
      unitAgorot: toAgorot(unit),
      qty: line.qty,
      note: line.note ?? '',
    });
  }
  const total = priced.reduce((sum, l) => sum + l.unitAgorot * l.qty, 0);
  if (total < ORDER_LIMITS.minAgorot) return 'too_small';
  return { lines: priced, total };
}

export async function orderingEnabled(db: SqlClient): Promise<boolean> {
  const [row] = await db.query<{ ordering_enabled: boolean }>('SELECT ordering_enabled FROM payment_settings WHERE id = 1');
  return row?.ordering_enabled ?? false;
}

/** The table's menu as published right now (never the draft), with its version id. */
export async function liveMenu(db: SqlClient, menuId: string | null): Promise<{ menu: Menu; versionId: string } | null> {
  if (!menuId) return null;
  const [row] = await db.query<{ version_id: string; data: unknown }>(
    'SELECT p.version_id, v.data FROM publications p JOIN menu_versions v ON v.id = p.version_id WHERE p.menu_id = $1',
    [menuId],
  );
  if (!row) return null;
  const parsed = parseMenu(row.data);
  // Orders are added to a bill in shekels: other currencies can't be ordered from.
  return parsed.ok && parsed.menu.currency === 'ILS' ? { menu: parsed.menu, versionId: row.version_id } : null;
}

export interface GuestOrderStatus {
  id: string;
  status: 'new' | 'accepted' | 'rejected';
  totalAgorot: number;
  rejectReason: string | null;
  createdAt: Date;
}

/** This table's orders from the last few hours (what the guest's cart shows as sent). */
export async function recentTableOrders(db: SqlClient, tableId: string): Promise<GuestOrderStatus[]> {
  const rows = await db.query<{ id: string; status: GuestOrderStatus['status']; total_agorot: number; reject_reason: string | null; created_at: Date }>(
    `SELECT id, status, total_agorot, reject_reason, created_at FROM orders
     WHERE table_id = $1 AND created_at > now() - interval '6 hours' ORDER BY created_at DESC LIMIT 10`,
    [tableId],
  );
  return rows.map((r) => ({ id: r.id, status: r.status, totalAgorot: r.total_agorot, rejectReason: r.reject_reason, createdAt: r.created_at }));
}

/** Records a guest's order (status "new"). Idempotent per table + key. */
export async function placeOrder(
  db: SqlClient,
  table: { id: string; menuId: string | null },
  request: OrderRequest,
): Promise<{ id: string; totalAgorot: number; created: boolean }> {
  const live = await liveMenu(db, table.menuId);
  if (!live) throw new HttpError(409, 'ordering_unavailable');
  const locale = request.lang && live.menu.locales.includes(request.lang) ? request.lang : live.menu.defaultLocale;
  const priced = priceOrder(live.menu, request.lines, locale);
  if (typeof priced === 'string') throw new HttpError(priced === 'unavailable_item' ? 409 : 400, priced);

  return db.transaction(async (tx) => {
    // Serialize orders of one table (limit check + idempotency) on its row.
    await tx.query('SELECT 1 FROM dining_tables WHERE id = $1 FOR UPDATE', [table.id]);
    const [same] = await tx.query<{ id: string; total_agorot: number }>('SELECT id, total_agorot FROM orders WHERE table_id = $1 AND idempotency_key = $2', [table.id, request.key]);
    if (same) return { id: same.id, totalAgorot: same.total_agorot, created: false };
    const [open] = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE table_id = $1 AND status = 'new'", [table.id]);
    if (open!.n >= ORDER_LIMITS.openPerTable) throw new HttpError(429, 'too_many_orders');
    const [order] = await tx.query<{ id: string }>(
      `INSERT INTO orders (table_id, menu_id, version_id, total_agorot, locale, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [table.id, table.menuId, live.versionId, priced.total, locale, request.key],
    );
    for (const [i, l] of priced.lines.entries()) {
      await tx.query(
        `INSERT INTO order_lines (order_id, position, item_id, variant_id, name, variant_label, unit_agorot, qty, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [order!.id, i, l.itemId, l.variantId, l.name, l.variantLabel, l.unitAgorot, l.qty, l.note],
      );
    }
    return { id: order!.id, totalAgorot: priced.total, created: true };
  });
}

/**
 * A waiter accepts an order: its total joins the table's open bill, or opens one. Same lock order as
 * checkout (the order, then the bill row), so a guest paying at that moment sees a consistent bill.
 */
export async function acceptOrder(db: SqlClient, orderId: string, userId: string): Promise<{ billId: string }> {
  return db.transaction(async (tx) => {
    const [order] = await tx.query<{ status: string; table_id: string; total_agorot: number }>(
      'SELECT status, table_id, total_agorot FROM orders WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    if (!order) throw notFound();
    if (order.status !== 'new') throw conflict('order_not_new');
    const [bill] = await tx.query<{ id: string; amount_agorot: number }>(
      "SELECT id, amount_agorot FROM bills WHERE table_id = $1 AND status = 'open' FOR UPDATE",
      [order.table_id],
    );
    let billId: string;
    if (bill) {
      if (bill.amount_agorot + order.total_agorot > ORDER_LIMITS.billMaxAgorot) throw conflict('bill_too_large');
      await tx.query('UPDATE bills SET amount_agorot = amount_agorot + $2 WHERE id = $1', [bill.id, order.total_agorot]);
      billId = bill.id;
    } else {
      const [created] = await tx.query<{ id: string }>(
        'INSERT INTO bills (table_id, amount_agorot, opened_by) VALUES ($1, $2, $3) RETURNING id',
        [order.table_id, order.total_agorot, userId],
      );
      billId = created!.id;
    }
    await tx.query("UPDATE orders SET status = 'accepted', bill_id = $2, decided_at = now(), decided_by = $3 WHERE id = $1", [orderId, billId, userId]);
    await audit(tx, { userId, action: 'order.accept', targetType: 'order', targetId: orderId, meta: { agorot: order.total_agorot, bill: billId } });
    return { billId };
  });
}

export async function rejectOrder(db: SqlClient, orderId: string, userId: string, reason: string): Promise<void> {
  const [row] = await db.query<{ id: string }>(
    "UPDATE orders SET status = 'rejected', reject_reason = $2, decided_at = now(), decided_by = $3 WHERE id = $1 AND status = 'new' RETURNING id",
    [orderId, reason || null, userId],
  );
  if (!row) {
    const [exists] = await db.query('SELECT 1 FROM orders WHERE id = $1', [orderId]);
    if (!exists) throw notFound();
    throw conflict('order_not_new');
  }
  await audit(db, { userId, action: 'order.reject', targetType: 'order', targetId: orderId });
}
