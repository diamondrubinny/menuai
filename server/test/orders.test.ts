/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
// Ordering from the published menu (Phase 3e): server-side pricing, waiter approval into the bill.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { ORIGIN, testApp } from './helpers';
import { issueLoginToken, redeemLoginToken } from '../src/auth/service';
import type { SqlClient } from '../src/db/sql';
import { parseMenu, type Menu } from '../../src/core/schema';
import { priceOrder } from '../src/orders/service';

const KEY = randomBytes(32).toString('base64');

function menu(over: Record<string, unknown> = {}): Menu {
  const parsed = parseMenu({
    schemaVersion: 1, id: 'm1', defaultLocale: 'he', locales: ['he', 'en'], currency: 'ILS',
    title: { he: 'לומייר', en: 'Lumiere' },
    sections: [
      {
        id: 's1', title: { he: 'ראשונות' },
        items: [
          { id: 'soup', name: { he: 'מרק', en: 'Soup' }, price: 42.5 },
          { id: 'wine', name: { he: 'יין', en: 'Wine' }, variants: [{ id: 'glass', label: { he: 'כוס', en: 'Glass' }, price: 38 }, { id: 'bottle', label: { he: 'בקבוק' }, price: 160 }] },
          { id: 'gone', name: { he: 'נגמר' }, price: 30, soldOut: true },
          { id: 'secret', name: { he: 'סודי' }, price: 99, hidden: true },
          { id: 'free', name: { he: 'מים' } },
        ],
      },
      { id: 's2', hidden: true, items: [{ id: 'hiddensec', name: { he: 'x' }, price: 10 }] },
    ],
    ...over,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.menu;
}

describe('order pricing (server-side, from the published menu)', () => {
  it('prices lines in agorot from the menu, never from the request', () => {
    const r = priceOrder(menu(), [{ itemId: 'soup', qty: 2, note: 'בלי בצל' }, { itemId: 'wine', variantId: 'bottle', qty: 1 }], 'en');
    expect(r).toEqual({
      total: 8500 + 16000,
      lines: [
        { itemId: 'soup', variantId: null, name: 'Soup', variantLabel: null, unitAgorot: 4250, qty: 2, note: 'בלי בצל' },
        { itemId: 'wine', variantId: 'bottle', name: 'Wine', variantLabel: 'בקבוק', unitAgorot: 16000, qty: 1, note: '' },
      ],
    });
  });

  it('refuses unknown, hidden, sold-out, unpriced items and bad variants', () => {
    const m = menu();
    expect(priceOrder(m, [{ itemId: 'nope', qty: 1 }], 'he')).toBe('unknown_item');
    expect(priceOrder(m, [{ itemId: 'secret', qty: 1 }], 'he')).toBe('unknown_item');
    expect(priceOrder(m, [{ itemId: 'hiddensec', qty: 1 }], 'he')).toBe('unknown_item');
    expect(priceOrder(m, [{ itemId: 'gone', qty: 1 }], 'he')).toBe('unavailable_item');
    expect(priceOrder(m, [{ itemId: 'free', qty: 1 }], 'he')).toBe('no_price');
    expect(priceOrder(m, [{ itemId: 'wine', qty: 1 }], 'he')).toBe('variant_required');
    expect(priceOrder(m, [{ itemId: 'wine', variantId: 'jug', qty: 1 }], 'he')).toBe('unknown_variant');
    expect(priceOrder(m, [{ itemId: 'soup', variantId: 'glass', qty: 1 }], 'he')).toBe('unknown_variant');
  });
});

describe('ordering from the table', () => {
  let app: FastifyInstance;
  let db: SqlClient;
  const cookies = { owner: '', editor: '', viewer: '' };
  type As = keyof typeof cookies | 'guest';
  let token = '';
  let tableId = '';

  async function seed(role: keyof typeof cookies) {
    const [row] = await db.query<{ id: string }>('INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id', [`${role}@example.com`, role]);
    cookies[role] = `menuai_session=${(await redeemLoginToken(db, (await issueLoginToken(db, row!.id, 15))!, 'test'))!.sessionToken}`;
  }
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, as: As, payload?: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
    app.inject({ method, url, payload: payload as object, headers: { ...headers, ...(as === 'guest' ? {} : { cookie: cookies[as] }) } });

  async function publish(m: Menu) {
    const [mm] = await db.query<{ id: string }>("INSERT INTO menus (slug, draft) VALUES ('lumiere', $1) ON CONFLICT (slug) DO UPDATE SET draft = $1 RETURNING id", [JSON.stringify(m)]);
    const [v] = await db.query<{ id: string }>(
      "INSERT INTO menu_versions (menu_id, version, data) VALUES ($1, (SELECT COALESCE(max(version), 0) + 1 FROM menu_versions WHERE menu_id = $1), $2) RETURNING id",
      [mm!.id, JSON.stringify(m)],
    );
    await db.query(
      "INSERT INTO publications (menu_id, public_slug, version_id) VALUES ($1, 'lumiere', $2) ON CONFLICT (menu_id) DO UPDATE SET version_id = $2",
      [mm!.id, v!.id],
    );
    return mm!.id;
  }

  const order = (lines: unknown, key = randomBytes(12).toString('base64url'), as: As = 'guest', headers?: Record<string, string>) =>
    call('POST', `/t/${token}/order`, as, { key, lang: 'he', lines }, headers);

  beforeEach(async () => {
    ({ app, db } = await testApp({ config: { PAYMENTS_KEY: KEY } }));
    for (const r of ['owner', 'editor', 'viewer'] as const) await seed(r);
    const menuId = await publish(menu());
    token = randomBytes(16).toString('base64url');
    const [t] = await db.query<{ id: string }>("INSERT INTO dining_tables (label, token, menu_id) VALUES ('7', $1, $2) RETURNING id", [token, menuId]);
    tableId = t!.id;
  });
  afterEach(async () => {
    await app.close();
    await db.close();
  });

  const enable = async (enabled = true) => expect((await call('PUT', '/api/orders/settings', 'owner', { enabled })).statusCode).toBe(200);

  it('is off until the owner turns it on (owner only), and then offers the live menu with server prices', async () => {
    expect((await call('GET', `/t/${token}/order`, 'guest')).json()).toEqual({ enabled: false, items: {}, orders: [] });
    expect((await order([{ itemId: 'soup', qty: 1 }])).json()).toEqual({ error: 'ordering_unavailable' });
    expect((await call('PUT', '/api/orders/settings', 'editor', { enabled: true })).statusCode).toBe(403);
    await enable();
    const res = await call('GET', `/t/${token}/order?lang=en`, 'guest');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      enabled: true,
      orders: [],
      items: {
        soup: { name: 'Soup', price: 4250 },
        wine: { name: 'Wine', variants: [{ id: 'glass', label: 'Glass', price: 3800 }, { id: 'bottle', label: 'בקבוק', price: 16000 }] },
      },
    });
    expect((await call('GET', `/t/${'x'.repeat(22)}/order`, 'guest')).statusCode).toBe(404);
  });

  it('records an order with server-side prices, once per key, and only from our own origin', async () => {
    await enable();
    // A tampered price or total in the request is simply not part of the schema.
    expect((await order([{ itemId: 'soup', qty: 1, price: 1 }])).statusCode).toBe(400);
    expect((await call('POST', `/t/${token}/order`, 'guest', { key: 'k'.repeat(16), lines: [{ itemId: 'soup', qty: 1 }], total: 1 })).statusCode).toBe(400);
    const key = randomBytes(12).toString('base64url');
    const first = await order([{ itemId: 'soup', qty: 2, note: '  בלי\nבצל  ' }, { itemId: 'wine', variantId: 'glass', qty: 1 }], key);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ totalAgorot: 8500 + 3800 });
    const again = await order([{ itemId: 'soup', qty: 9 }], key);
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.json().id);
    const lines = await db.query('SELECT name, variant_label, unit_agorot, qty, note FROM order_lines ORDER BY position');
    expect(lines).toEqual([
      { name: 'מרק', variant_label: null, unit_agorot: 4250, qty: 2, note: 'בלי בצל' },
      { name: 'יין', variant_label: 'כוס', unit_agorot: 3800, qty: 1, note: '' },
    ]);
    // Cross-site posts are refused by the global Origin check.
    expect((await order([{ itemId: 'soup', qty: 1 }], undefined, 'guest', { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await call('GET', `/t/${token}/order`, 'guest')).json().orders).toMatchObject([{ status: 'new', totalAgorot: 12300, rejectReason: null }]);
  });

  it('refuses what the menu does not offer, and over-limit orders', async () => {
    await enable();
    expect((await order([{ itemId: 'gone', qty: 1 }])).json()).toEqual({ error: 'unavailable_item' });
    expect((await order([{ itemId: 'secret', qty: 1 }])).json()).toEqual({ error: 'unknown_item' });
    expect((await order([{ itemId: 'wine', qty: 1 }])).json()).toEqual({ error: 'variant_required' });
    expect((await order([{ itemId: 'soup', qty: 21 }])).statusCode).toBe(400);
    expect((await order([{ itemId: 'soup', qty: 1, note: 'x'.repeat(141) }])).statusCode).toBe(400);
    expect((await order(Array.from({ length: 31 }, () => ({ itemId: 'soup', qty: 1 })))).statusCode).toBe(400);
    expect((await order([])).statusCode).toBe(400);
  });

  it('limits waiting orders per table, and requests per minute', async () => {
    await enable();
    for (let i = 0; i < 5; i++) expect((await order([{ itemId: 'soup', qty: 1 }])).statusCode).toBe(201);
    // Five orders already wait for a waiter: a leaked QR can't flood the screen.
    expect((await order([{ itemId: 'soup', qty: 1 }])).json()).toEqual({ error: 'too_many_orders' });
    for (let i = 0; i < 24; i++) await order([{ itemId: 'soup', qty: 1 }]);
    // ...and the per-IP limit (30 a minute: tablets often share one IP) is there as well.
    const limited = await order([{ itemId: 'soup', qty: 1 }]);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).not.toEqual({ error: 'too_many_orders' });
  });

  it('prices from the published version, not the draft', async () => {
    await enable();
    await db.query("UPDATE menus SET draft = jsonb_set(draft, '{sections,0,items,0,price}', '1') WHERE slug = 'lumiere'");
    expect((await order([{ itemId: 'soup', qty: 1 }])).json().totalAgorot).toBe(4250);
  });

  it('lets a waiter accept an order into the open bill, or open one, and reject with a reason (editor+)', async () => {
    await enable();
    const a = (await order([{ itemId: 'soup', qty: 2 }])).json().id as string;
    const b = (await order([{ itemId: 'wine', variantId: 'bottle', qty: 1 }])).json().id as string;
    const c = (await order([{ itemId: 'soup', qty: 1 }])).json().id as string;

    expect((await call('GET', '/api/orders', 'viewer')).statusCode).toBe(403);
    const list = (await call('GET', '/api/orders', 'editor')).json();
    expect(list.enabled).toBe(true);
    expect(list.orders.map((o: { id: string }) => o.id)).toEqual([c, b, a]);
    expect(list.orders[2]).toMatchObject({ tableLabel: '7', totalAgorot: 8500, lines: [{ name: 'מרק', qty: 2, unitAgorot: 4250 }] });

    expect((await call('POST', `/api/orders/${a}/accept`, 'viewer')).statusCode).toBe(403);
    const accepted = await call('POST', `/api/orders/${a}/accept`, 'editor');
    expect(accepted.statusCode).toBe(200);
    const billId = accepted.json().billId as string;
    expect((await db.query('SELECT amount_agorot, status FROM bills WHERE id = $1', [billId]))[0]).toEqual({ amount_agorot: 8500, status: 'open' });
    // The next accepted order joins the same open bill.
    expect((await call('POST', `/api/orders/${b}/accept`, 'editor')).json().billId).toBe(billId);
    expect((await db.query<{ amount_agorot: number }>('SELECT amount_agorot FROM bills WHERE id = $1', [billId]))[0]!.amount_agorot).toBe(24500);
    expect((await call('POST', `/api/orders/${a}/accept`, 'editor')).json()).toEqual({ error: 'order_not_new' });

    expect((await call('POST', `/api/orders/${c}/reject`, 'editor', { reason: 'נגמר המרק' })).statusCode).toBe(200);
    expect((await call('POST', `/api/orders/${c}/reject`, 'editor', {})).json()).toEqual({ error: 'order_not_new' });
    expect((await call('POST', '/api/orders/not-a-uuid/accept', 'editor')).statusCode).toBe(404);
    expect((await call('POST', '/api/orders/00000000-0000-4000-8000-000000000000/reject', 'editor', {})).statusCode).toBe(404);

    // The guest's cart sees the outcome; the open list empties; everything is audited.
    const guest = (await call('GET', `/t/${token}/order`, 'guest')).json().orders as { id: string; status: string; rejectReason: string | null }[];
    expect(guest.find((o) => o.id === c)).toMatchObject({ status: 'rejected', rejectReason: 'נגמר המרק' });
    expect((await call('GET', '/api/orders', 'editor')).json().orders).toEqual([]);
    expect((await call('GET', '/api/orders?view=recent', 'editor')).json().orders).toHaveLength(3);
    expect(await db.query("SELECT 1 FROM audit_log WHERE action IN ('order.accept', 'order.reject')")).toHaveLength(3);
  });

  it('opens a new bill after the previous one was paid, and never lets another table see its orders', async () => {
    await enable();
    await db.query("INSERT INTO bills (table_id, amount_agorot, status, closed_at) VALUES ($1, 5000, 'paid', now())", [tableId]);
    const a = (await order([{ itemId: 'soup', qty: 1 }])).json().id as string;
    const billId = (await call('POST', `/api/orders/${a}/accept`, 'editor')).json().billId as string;
    expect((await db.query<{ amount_agorot: number; status: string }>('SELECT amount_agorot, status FROM bills WHERE id = $1', [billId]))[0]).toEqual({ amount_agorot: 4250, status: 'open' });
    const other = randomBytes(16).toString('base64url');
    await db.query("INSERT INTO dining_tables (label, token) VALUES ('8', $1)", [other]);
    expect((await call('GET', `/t/${other}/order`, 'guest')).json()).toEqual({ enabled: false, items: {}, orders: [] });
  });
});
