/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { ORIGIN, testApp, testConfig } from './helpers';
import { issueLoginToken, redeemLoginToken } from '../src/auth/service';
import type { SqlClient } from '../src/db/sql';
import { loadConfig } from '../src/config';
import { agorotToDecimal, computeCharge, decimalToAgorot, remainingAgorot } from '../src/payments/money';
import { open, seal } from '../src/payments/crypto';
import { PAY_SCRIPT, PAY_SCRIPT_HASH, esc } from '../src/payments/pages';
import { plainDescription } from '../src/payments/guest';
import { safeUrl } from '../src/app';
import { applyRetention } from '../src/maintenance/retention';
import { createMediaStore } from '../src/uploads/store';
import { createHash } from 'node:crypto';
import { createSampleMenu } from '../../src/core/sample';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const KEY = randomBytes(32).toString('base64');

describe('money', () => {
  const tips = [10, 12, 15];
  const bill = { amount: 30000, paid: 0, pending: 0 };

  it('charges the whole balance, equal splits and custom amounts exactly, in agorot', () => {
    expect(computeCharge(bill, { kind: 'full' }, { kind: 'none' }, tips)).toEqual({ share: 30000, tip: 0, total: 30000 });
    expect(computeCharge(bill, { kind: 'split', parts: 3 }, { kind: 'percent', percent: 10 }, tips)).toEqual({ share: 10000, tip: 1000, total: 11000 });
    // ₪100.00 / 3 rounds *up* to the agora; the last diner pays only what is left.
    expect(computeCharge({ amount: 10000, paid: 0, pending: 0 }, { kind: 'split', parts: 3 }, { kind: 'none' }, tips)).toMatchObject({ share: 3334 });
    expect(computeCharge({ amount: 10000, paid: 6668, pending: 0 }, { kind: 'split', parts: 3 }, { kind: 'none' }, tips)).toMatchObject({ share: 3332 });
    expect(computeCharge(bill, { kind: 'custom', agorot: 4550 }, { kind: 'custom', agorot: 500 }, tips)).toEqual({ share: 4550, tip: 500, total: 5050 });
  });

  it('refuses amounts outside the open balance, unknown tip percents and oversized tips', () => {
    expect(computeCharge({ amount: 30000, paid: 30000, pending: 0 }, { kind: 'full' }, { kind: 'none' }, tips)).toBe('nothing_to_pay');
    expect(computeCharge({ amount: 30000, paid: 20000, pending: 10000 }, { kind: 'full' }, { kind: 'none' }, tips)).toBe('nothing_to_pay');
    expect(computeCharge(bill, { kind: 'custom', agorot: 30001 }, { kind: 'none' }, tips)).toBe('invalid_share');
    expect(computeCharge(bill, { kind: 'custom', agorot: 99 }, { kind: 'none' }, tips)).toBe('invalid_share');
    expect(computeCharge(bill, { kind: 'full' }, { kind: 'percent', percent: 50 }, tips)).toBe('invalid_tip');
    expect(computeCharge(bill, { kind: 'custom', agorot: 1000 }, { kind: 'custom', agorot: 1001 }, tips)).toBe('invalid_tip');
    // Under ₪1 is fine only when it closes the bill.
    expect(computeCharge({ amount: 10000, paid: 9950, pending: 0 }, { kind: 'custom', agorot: 50 }, { kind: 'none' }, tips)).toMatchObject({ total: 50 });
  });

  it('converts between agorot and decimal strings without floating point drift', () => {
    expect(agorotToDecimal(12345)).toBe('123.45');
    expect(agorotToDecimal(5)).toBe('0.05');
    expect(decimalToAgorot('123.45')).toBe(12345);
    expect(decimalToAgorot('0.1')).toBe(10);
    expect(decimalToAgorot(19.99)).toBe(1999);
    for (const bad of ['1.234', '-5', 'abc', '', '1e3', null]) expect(decimalToAgorot(bad)).toBeNull();
    expect(remainingAgorot({ amount: 100, paid: 150, pending: 0 })).toBe(0);
  });
});

describe('credential encryption', () => {
  it('round-trips, and rejects tampering or the wrong key', () => {
    const sealed = seal('{"userId":"abc"}', KEY);
    expect(sealed).not.toContain('abc');
    expect(open(sealed, KEY)).toBe('{"userId":"abc"}');
    const [v, iv, tag, data] = sealed.split('.');
    const flipped = Buffer.from(data!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => open([v, iv, tag, flipped.toString('base64url')].join('.'), KEY)).toThrow();
    expect(() => open(sealed, randomBytes(32).toString('base64'))).toThrow();
  });
});

describe('config', () => {
  const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x/y', PUBLIC_URL: 'https://menu.example.com' };
  it('refuses the demo provider in production and malformed keys', () => {
    expect(() => loadConfig({ ...base, PAYMENTS_ALLOW_FAKE: 'true' })).toThrow(/PAYMENTS_ALLOW_FAKE/);
    expect(() => loadConfig({ ...base, PAYMENTS_KEY: 'short' })).toThrow(/PAYMENTS_KEY/);
    expect(loadConfig({ ...base, PAYMENTS_KEY: KEY }).PAYMENTS_KEY).toBe(KEY);
  });
  it('keeps the guest script hash in sync with the script', () => {
    expect(PAY_SCRIPT_HASH).toBe(createHash('sha256').update(PAY_SCRIPT).digest('base64'));
  });
  it('keeps table codes and query strings out of the server log', () => {
    expect(safeUrl('/t/AbCdEfGhIjKlMnOpQrStUv/done/1?lang=he')).toBe('/t/[table]/done/1?[redacted]');
    expect(safeUrl('/t/AbCdEfGhIjKlMnOpQrStUv')).toBe('/t/[table]');
    expect(safeUrl('/m/lumiere')).toBe('/m/lumiere');
  });
  it('sends providers plain descriptions', () => {
    expect(plainDescription('Café <Lumière> table #7!')).toBe('Café Lumière table 7');
    expect(esc('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
  });
});

describe('pay at the table', () => {
  let app: FastifyInstance;
  let db: SqlClient;
  const cookies: Record<'owner' | 'editor' | 'viewer', string> = { owner: '', editor: '', viewer: '' };
  type As = keyof typeof cookies | 'anon' | 'guest';

  async function seed(role: keyof typeof cookies) {
    const [row] = await db.query<{ id: string }>('INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id', [`${role}@example.com`, role, role]);
    const session = await redeemLoginToken(db, (await issueLoginToken(db, row!.id, 15))!, 'test');
    cookies[role] = `menuai_session=${session!.sessionToken}`;
  }

  function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, as: As, payload?: unknown, headers: Record<string, string> = {}) {
    const auth = as === 'anon' || as === 'guest' ? {} : { cookie: cookies[as] };
    return app.inject({ method, url, payload: payload as object, headers: { origin: ORIGIN, ...auth, ...headers } });
  }
  /** A guest submitting the plain HTML form (what a browser sends without JavaScript). */
  const form = (url: string, fields: Record<string, string>, origin: string | null = ORIGIN) =>
    app.inject({
      method: 'POST',
      url,
      payload: new URLSearchParams(fields).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) },
    });

  async function setup(overrides: Record<string, string> = {}) {
    ({ app, db } = await testApp({ config: { PAYMENTS_KEY: KEY, PAYMENTS_ALLOW_FAKE: 'true', ...overrides } }));
    for (const role of ['owner', 'editor', 'viewer'] as const) await seed(role);
  }

  async function enable() {
    const res = await call('PUT', '/api/payments/settings', 'owner', { enabled: true, provider: 'fake', mode: 'test', tipPercents: [15, 10, 12, 10] });
    expect(res.statusCode).toBe(200);
  }

  async function table(label = '7') {
    const res = await call('POST', '/api/payments/tables', 'owner', { label });
    expect(res.statusCode).toBe(201);
    const list = (await call('GET', '/api/payments/tables', 'editor')).json().tables as { id: string; label: string; url: string }[];
    const t = list.find((x) => x.label === label)!;
    return { ...t, path: new URL(t.url).pathname };
  }

  async function openBill(tableId: string, amountAgorot: number) {
    const res = await call('POST', '/api/payments/bills', 'editor', { tableId, amountAgorot });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  const bill = async (id: string) =>
    ((await call('GET', '/api/payments/bills?view=recent', 'editor')).json().bills as { id: string; status: string; paidAgorot: number; tipsAgorot: number; pendingAgorot: number; payments: { status: string; transactionRef: string | null }[] }[]).find((b) => b.id === id)!;

  /** Guest flow up to the provider page: returns the demo page path and the payment id. */
  async function checkout(tablePath: string, fields: Record<string, string>) {
    const res = await form(`${tablePath}/pay`, fields);
    expect(res.statusCode, res.body).toBe(303);
    const location = new URL(res.headers.location as string);
    expect(location.pathname).toMatch(/^\/pay\/demo\/[0-9a-f-]{36}$/);
    return { demoPath: location.pathname, paymentId: location.pathname.split('/').pop()! };
  }

  async function provider(demoPath: string, outcome: 'paid' | 'declined') {
    const res = await form(demoPath, { outcome });
    expect(res.statusCode).toBe(303);
    return new URL(res.headers.location as string, ORIGIN).pathname + new URL(res.headers.location as string, ORIGIN).search;
  }

  beforeEach(async () => setup());
  afterEach(async () => {
    await app.close();
    await db.close();
  });

  it('enforces roles on every staff endpoint (server-side, not by hiding buttons)', async () => {
    await enable();
    const t = await table();
    expect((await call('GET', '/api/payments/settings', 'editor')).statusCode).toBe(403);
    expect((await call('PUT', '/api/payments/settings', 'editor', { enabled: false, provider: 'fake', mode: 'test', tipPercents: [] })).statusCode).toBe(403);
    expect((await call('POST', '/api/payments/tables', 'editor', { label: '9' })).statusCode).toBe(403);
    expect((await call('POST', `/api/payments/tables/${t.id}/rotate`, 'editor')).statusCode).toBe(403);
    expect((await call('GET', '/api/payments/tables', 'viewer')).statusCode).toBe(403);
    expect((await call('POST', '/api/payments/bills', 'viewer', { tableId: t.id, amountAgorot: 1000 })).statusCode).toBe(403);
    expect((await call('GET', '/api/payments/bills', 'anon')).statusCode).toBe(401);
    expect((await call('GET', '/api/payments/status', 'viewer')).json()).toMatchObject({ configured: true, enabled: true, provider: 'fake', mode: 'test' });
  });

  it('is off without PAYMENTS_KEY', async () => {
    await app.close();
    await db.close();
    await setup({ PAYMENTS_KEY: '' });
    expect((await call('GET', '/api/payments/status', 'owner')).json()).toMatchObject({ configured: false, enabled: false });
    expect((await call('GET', '/api/payments/settings', 'owner')).statusCode).toBe(503);
    expect((await call('GET', '/api/payments/tables', 'editor')).statusCode).toBe(503);
  });

  it('validates settings: demo is test-only, providers must be available, tips are normalized', async () => {
    expect((await call('PUT', '/api/payments/settings', 'owner', { enabled: true, provider: 'fake', mode: 'live', tipPercents: [] })).json()).toEqual({ error: 'demo_is_test_only' });
    expect((await call('PUT', '/api/payments/settings', 'owner', { enabled: true, provider: 'grow', mode: 'test', tipPercents: [] })).json()).toEqual({ error: 'credentials_required' });
    expect((await call('PUT', '/api/payments/settings', 'owner', { enabled: true, provider: 'fake', mode: 'test', tipPercents: [80] })).statusCode).toBe(400);
    await enable();
    const res = (await call('GET', '/api/payments/settings', 'owner')).json();
    expect(res.settings).toMatchObject({ enabled: true, provider: 'fake', tipPercents: [10, 12, 15], hasCredentials: false });
    expect(JSON.stringify(res)).not.toMatch(/credentials_enc|"credentials"/);
    const [audit] = await db.query<{ meta: unknown }>("SELECT meta FROM audit_log WHERE action = 'payments.settings'");
    expect(audit!.meta).toMatchObject({ provider: 'fake', credentials: 'kept' });
  });

  it('lets a guest pay their share with a tip; the bill closes itself when fully paid', async () => {
    await enable();
    const t = await table();
    const billId = await openBill(t.id, 30000);

    const page = await call('GET', t.path, 'guest');
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-security-policy']).toContain(`script-src 'sha256-${PAY_SCRIPT_HASH}'`);
    expect(page.headers['content-security-policy']).toContain("form-action 'self'");
    expect(page.headers['referrer-policy']).toBe('same-origin');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['set-cookie']).toBeUndefined();
    expect(page.body).toContain('lang="he" dir="rtl"');
    expect(page.body).toMatch(/300/);
    expect(page.body).toContain('מצב בדיקה');

    // Diner 1: a third + 10% tip.
    const one = await checkout(t.path, { share: 'split', parts: '3', tip: '10' });
    expect((await call('GET', one.demoPath, 'guest')).body).toMatch(/110/);
    const done = await provider(one.demoPath, 'paid');
    expect(done).toBe(`${t.path}/done/${one.paymentId}?lang=he`);
    const result = await call('GET', done, 'guest');
    expect(result.body).toContain('התשלום התקבל');
    let b = await bill(billId);
    expect(b).toMatchObject({ status: 'open', paidAgorot: 10000, tipsAgorot: 1000 });
    expect(b.payments[0]!.transactionRef).toMatch(/^DEMO-/);

    // Diner 2 pays the rest; the bill is now paid and the table page says so.
    const two = await checkout(t.path, { share: 'full', tip: 'custom', tipAmount: '25.50' });
    await provider(two.demoPath, 'paid');
    b = await bill(billId);
    expect(b).toMatchObject({ status: 'paid', paidAgorot: 30000, tipsAgorot: 3550 });
    expect((await call('GET', t.path, 'guest')).body).toContain('החשבון שולם במלואו');
    const paidAudits = await db.query("SELECT 1 FROM audit_log WHERE action = 'payment.paid'");
    expect(paidAudits).toHaveLength(2);
  });

  it('reserves a share during checkout, so two guests cannot both pay the whole bill', async () => {
    await enable();
    const t = await table();
    const billId = await openBill(t.id, 20000);
    await checkout(t.path, { share: 'full' });
    const second = await form(`${t.path}/pay`, { share: 'full' });
    expect(second.statusCode).toBe(409);
    expect(second.body).toContain('אין יתרה לתשלום');
    expect((await bill(billId)).pendingAgorot).toBe(20000);
  });

  it('releases the reservation when the payment is declined', async () => {
    await enable();
    const t = await table();
    const billId = await openBill(t.id, 20000);
    const { demoPath, paymentId } = await checkout(t.path, { share: 'full' });
    const back = await provider(demoPath, 'declined');
    expect(back).toBe(`${t.path}?lang=he`);
    expect((await call('GET', `${t.path}/done/${paymentId}`, 'guest')).body).toContain('התשלום לא הושלם');
    const b = await bill(billId);
    expect(b).toMatchObject({ status: 'open', paidAgorot: 0, pendingAgorot: 0 });
    await checkout(t.path, { share: 'full' }); // can try again right away
  });

  it('re-validates every form field on the server and keeps what the guest typed', async () => {
    await enable();
    const t = await table();
    await openBill(t.id, 10000);
    const tooMuch = await form(`${t.path}/pay`, { share: 'custom', shareAmount: '100.01' });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.body).toContain('value="100.01"');
    expect((await form(`${t.path}/pay`, { share: 'full', tip: '50' })).statusCode).toBe(400);
    expect((await form(`${t.path}/pay`, { share: 'split', parts: '99' })).statusCode).toBe(400);
    expect((await form(`${t.path}/pay`, { share: 'custom', shareAmount: '1.234' })).statusCode).toBe(400);
    expect((await form(`${t.path}/pay`, { share: 'full', fullName: '"><script>alert(1)</script>' })).statusCode).toBe(303);
  });

  it('never trusts the browser: forged notifications and success redirects do not mark anything paid', async () => {
    await enable();
    const t = await table();
    const billId = await openBill(t.id, 10000);
    const { paymentId } = await checkout(t.path, { share: 'full' });

    // A forged server notification without the payment's secret.
    const forged = await app.inject({ method: 'POST', url: '/api/payments/notify/fake', payload: { paymentId, demoSecret: 'x'.repeat(22) } });
    expect(forged.statusCode).toBe(200);
    expect(forged.json()).toMatchObject({ outcome: 'ignored' });
    // Jumping straight to the success page.
    expect((await call('GET', `${t.path}/done/${paymentId}`, 'guest')).body).toContain('מאמתים');
    expect((await bill(billId)).paidAgorot).toBe(0);
    const [event] = await db.query<{ outcome: string }>("SELECT outcome FROM payment_events WHERE kind = 'notify'");
    expect(event!.outcome).toBe('no_match');
  });

  it('refuses a provider-confirmed charge for a different amount than requested', async () => {
    await enable();
    const t = await table();
    const billId = await openBill(t.id, 10000);
    const { demoPath, paymentId } = await checkout(t.path, { share: 'full' });
    await db.query("UPDATE payments SET provider_ref = provider_ref || '{\"amount\":\"100\"}'::jsonb WHERE id = $1", [paymentId]);
    await provider(demoPath, 'paid');
    expect((await bill(billId)).paidAgorot).toBe(0);
    const [event] = await db.query<{ outcome: string }>("SELECT outcome FROM payment_events WHERE payment_id = $1", [paymentId]);
    expect(event!.outcome).toBe('amount_mismatch');
  });

  it('keeps tables apart: no peeking at another table’s payment, old QR codes stop working', async () => {
    await enable();
    const a = await table('1');
    const b = await table('2');
    await openBill(a.id, 10000);
    const { paymentId } = await checkout(a.path, { share: 'full' });
    expect((await call('GET', `${b.path}/done/${paymentId}`, 'guest')).statusCode).toBe(404);
    expect((await call('GET', `/t/${'A'.repeat(22)}`, 'guest')).statusCode).toBe(404);
    expect((await call('GET', '/t/not-a-token', 'guest')).body).toContain('הקוד של השולחן לא פעיל');

    const rotated = await call('POST', `/api/payments/tables/${a.id}/rotate`, 'owner');
    expect((await call('GET', a.path, 'guest')).statusCode).toBe(404);
    expect((await call('GET', new URL(rotated.json().url).pathname, 'guest')).statusCode).toBe(200);
  });

  it('escapes staff-entered text on guest pages', async () => {
    await enable();
    const t = await table('<img src=x onerror=alert(1)>');
    await openBill(t.id, 10000);
    const page = await call('GET', t.path, 'guest');
    expect(page.body).not.toContain('<img src=x');
    expect(page.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('lets staff fix, close or cancel bills, within the rules', async () => {
    await enable();
    const t = await table();
    const billId = await openBill(t.id, 10000);
    expect((await call('POST', '/api/payments/bills', 'editor', { tableId: t.id, amountAgorot: 500 })).json()).toEqual({ error: 'bill_already_open' });
    const { demoPath } = await checkout(t.path, { share: 'custom', shareAmount: '40' });
    await provider(demoPath, 'paid');
    expect((await call('PATCH', `/api/payments/bills/${billId}`, 'editor', { amountAgorot: 3999 })).json()).toEqual({ error: 'amount_below_paid' });
    expect((await call('POST', `/api/payments/bills/${billId}/cancel`, 'editor')).json()).toEqual({ error: 'bill_has_payments' });
    // Lowering the bill to exactly what was paid settles it.
    expect((await call('PATCH', `/api/payments/bills/${billId}`, 'editor', { amountAgorot: 4000 })).statusCode).toBe(200);
    expect((await bill(billId)).status).toBe('paid');

    const second = await openBill(t.id, 5000);
    expect((await call('POST', `/api/payments/bills/${second}/close`, 'editor')).statusCode).toBe(200);
    expect((await call('GET', t.path, 'guest')).body).toContain('עדיין אין חשבון פתוח');
    const third = await openBill(t.id, 5000);
    expect((await call('POST', `/api/payments/bills/${third}/cancel`, 'editor')).statusCode).toBe(200);
  });

  /** Pretends a checkout started `minutes` ago (its provider page was left open). */
  const age = (paymentId: string, minutes: number) =>
    db.query(`UPDATE payments SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [paymentId, minutes]);
  /** A real provider charging late: the guest finished on a page we no longer expected. */
  const chargeLate = (paymentId: string) =>
    db.query(`UPDATE payments SET provider_ref = provider_ref || '{"outcome":"paid","txn":"LATE-1"}'::jsonb WHERE id = $1`, [paymentId]);

  it('releases an abandoned reservation only after asking the provider, and flags money that still arrives', async () => {
    await enable();
    const t = await table();
    const billId = await openBill(t.id, 10000);
    const a = await checkout(t.path, { share: 'full' });
    expect((await form(`${t.path}/pay`, { share: 'full' })).statusCode).toBe(409);
    await age(a.paymentId, 21);
    // Guest B can now pay: A's reservation was checked (still pending) and released.
    const b = await checkout(t.path, { share: 'full' });
    await provider(b.demoPath, 'paid');
    expect(await bill(billId)).toMatchObject({ status: 'paid', paidAgorot: 10000 });
    // A's provider session is over: approving it changes nothing.
    await provider(a.demoPath, 'paid');
    expect((await bill(billId)).paidAgorot).toBe(10000);
    // But if a provider charged A anyway, the money is recorded and flagged, never silently accepted.
    await chargeLate(a.paymentId);
    expect((await call('GET', `${t.path}/done/${a.paymentId}`, 'guest')).body).toContain('התשלום התקבל');
    const flagged = (await call('GET', '/api/payments/bills', 'editor')).json().bills.find((x: { id: string }) => x.id === billId);
    expect(flagged.payments.find((p: { id: string }) => p.id === a.paymentId)).toMatchObject({ status: 'paid', reviewReason: 'bill_not_open' });
  });

  it('a paid-before-release checkout is recorded as paid, not released', async () => {
    await enable();
    const t = await table();
    const billId = await openBill(t.id, 10000);
    const a = await checkout(t.path, { share: 'full' });
    await age(a.paymentId, 21);
    await chargeLate(a.paymentId); // paid, but the notification never arrived
    expect((await form(`${t.path}/pay`, { share: 'full' })).statusCode).toBe(200); // the bill is now paid: thank-you page
    expect(await bill(billId)).toMatchObject({ status: 'paid', paidAgorot: 10000 });
  });

  it('cannot cancel a bill while a guest is paying it; cancelling with an abandoned checkout is safe', async () => {
    await enable();
    const t = await table();
    const billId = await openBill(t.id, 10000);
    const a = await checkout(t.path, { share: 'full' });
    expect((await call('POST', `/api/payments/bills/${billId}/cancel`, 'editor')).json()).toEqual({ error: 'bill_has_payments' });
    await age(a.paymentId, 21);
    expect((await call('POST', `/api/payments/bills/${billId}/cancel`, 'editor')).statusCode).toBe(200);
    await provider(a.demoPath, 'paid'); // session over: no charge
    expect((await bill(billId)).paidAgorot).toBe(0);
    await chargeLate(a.paymentId);
    await call('GET', `${t.path}/done/${a.paymentId}`, 'guest');
    const open = (await call('GET', '/api/payments/bills', 'editor')).json().bills;
    expect(open.find((x: { id: string }) => x.id === billId).payments[0]).toMatchObject({ status: 'paid', reviewReason: 'bill_not_open' });
  });

  it('answers malformed payment ids with 404 / ignored, never a server error', async () => {
    await enable();
    const t = await table();
    await openBill(t.id, 10000);
    const bad = '-'.repeat(36);
    expect((await app.inject({ method: 'POST', url: '/api/payments/notify/fake', payload: { paymentId: bad, demoSecret: 'x' } })).json()).toMatchObject({ outcome: 'ignored' });
    expect((await call('GET', `${t.path}/done/${bad}`, 'guest')).statusCode).toBe(404);
    expect((await call('GET', `/pay/demo/${bad}`, 'guest')).statusCode).toBe(404);
    const res = await form(`${t.path}/pay`, { share: 'split', parts: 'abc' });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('NaN');
  });

  it('requires accepting the payment terms when the owner set a terms page', async () => {
    const put = (termsUrl: unknown) =>
      call('PUT', '/api/payments/settings', 'owner', { enabled: true, provider: 'fake', mode: 'test', tipPercents: [10], termsUrl });
    expect((await put('http://example.com/terms')).statusCode).toBe(400);
    expect((await put('javascript:alert(1)')).statusCode).toBe(400);
    expect((await put('https://lumiere.example/terms?x="<b>')).statusCode).toBe(200);
    const t = await table();
    await openBill(t.id, 10000);
    const page = await call('GET', t.path, 'guest');
    expect(page.body).toContain('name="agree"');
    expect(page.body).toContain('href="https://lumiere.example/terms?x=&quot;&lt;b&gt;"');
    const refused = await form(`${t.path}/pay`, { share: 'full' });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('צריך לאשר את תנאי התשלום');
    await checkout(t.path, { share: 'full', agree: 'yes' });
    expect((await call('GET', '/api/payments/settings', 'owner')).json().settings.termsUrl).toBe('https://lumiere.example/terms?x="<b>');
  });

  it('reports paid money by the business\'s calendar day (Israel time), owner only', async () => {
    await enable();
    const t = await table();
    await openBill(t.id, 20000);
    const one = await checkout(t.path, { share: 'custom', shareAmount: '100', tip: '10' });
    await provider(one.demoPath, 'paid');
    const two = await checkout(t.path, { share: 'full' });
    await provider(two.demoPath, 'paid');
    // 23:30 on 28 Oct and 00:30 on 29 Oct in Israel (UTC+2 after daylight saving ends).
    await db.query("UPDATE payments SET paid_at = '2026-10-28T21:30:00Z' WHERE id = $1", [one.paymentId]);
    await db.query("UPDATE payments SET paid_at = '2026-10-28T22:30:00Z' WHERE id = $1", [two.paymentId]);
    const res = await call('GET', '/api/payments/report?from=2026-10-28&to=2026-10-29', 'owner');
    expect(res.json()).toMatchObject({
      timezone: 'Asia/Jerusalem',
      days: [
        { date: '2026-10-28', mode: 'test', bills: 1, payments: 1, collectedAgorot: 10000, tipsAgorot: 1000, openReviews: 0 },
        { date: '2026-10-29', mode: 'test', bills: 1, payments: 1, collectedAgorot: 10000, tipsAgorot: 0, openReviews: 0 },
      ],
    });
    expect((await call('GET', '/api/payments/report?from=2026-10-28&to=2026-10-29', 'editor')).statusCode).toBe(403);
    for (const q of ['from=2026-10-29&to=2026-10-28', 'from=2026-01-01&to=2026-06-01', 'from=2026-02-30&to=2026-03-01', 'from=x&to=y', '']) {
      expect((await call('GET', `/api/payments/report?${q}`, 'owner')).statusCode).toBe(400);
    }
  });

  it('exports a CSV that Excel opens safely (no formulas), and audits the export', async () => {
    await enable();
    const t = await table('=HYPERLINK("https://evil.example","7")');
    await openBill(t.id, 5000);
    const p = await checkout(t.path, { share: 'full' });
    await provider(p.demoPath, 'paid');
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await call('GET', `/api/payments/report.csv?from=${yesterday}&to=${tomorrow}`, 'owner');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="menuai-payments-${yesterday}-to-${tomorrow}.csv"`);
    const [header, row] = res.body.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(res.body.startsWith('\uFEFF')).toBe(true);
    expect(header).toBe('"paid_at","table","amount","tip","total","provider","mode","reference","review","review_note"');
    expect(row).toContain(`"'=HYPERLINK(""https://evil.example"",""7"")"`);
    expect(row).toContain('"50.00","0.00","50.00","fake","test"');
    expect(today).toBeTruthy();
    expect(await db.query("SELECT 1 FROM audit_log WHERE action = 'payments.export'")).toHaveLength(1);
    expect((await call('GET', `/api/payments/report.csv?from=${yesterday}&to=${tomorrow}`, 'editor')).statusCode).toBe(403);
  });

  it('lets the owner resolve a flagged payment once, and then it leaves the open list', async () => {
    await enable();
    const t = await table();
    const billId = await openBill(t.id, 10000);
    const a = await checkout(t.path, { share: 'full' });
    await age(a.paymentId, 21);
    expect((await call('POST', `/api/payments/bills/${billId}/cancel`, 'editor')).statusCode).toBe(200);
    await chargeLate(a.paymentId);
    await call('GET', `${t.path}/done/${a.paymentId}`, 'guest');
    expect((await call('GET', '/api/payments/bills', 'editor')).json().bills.map((b: { id: string }) => b.id)).toContain(billId);

    const resolve = (as: As, note = 'Refunded in the Grow dashboard') => call('POST', `/api/payments/payments/${a.paymentId}/resolve`, as, { note });
    expect((await resolve('editor')).statusCode).toBe(403);
    expect((await resolve('owner', ' ')).statusCode).toBe(400);
    expect((await resolve('owner')).statusCode).toBe(200);
    expect((await resolve('owner')).json()).toEqual({ error: 'nothing_to_resolve' });
    expect((await call('POST', `/api/payments/payments/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}/resolve`, 'owner', { note: 'x' })).statusCode).toBe(404);
    expect((await call('GET', '/api/payments/bills', 'editor')).json().bills.map((b: { id: string }) => b.id)).not.toContain(billId);
    const recent = (await call('GET', '/api/payments/bills?view=recent', 'editor')).json().bills.find((b: { id: string }) => b.id === billId);
    expect(recent.payments[0]).toMatchObject({ reviewReason: 'bill_not_open', reviewNote: 'Refunded in the Grow dashboard' });
    expect(recent.payments[0].reviewResolvedAt).toBeTruthy();
  });

  it('links the table page to its published menu, carrying the table code for the way back to paying', async () => {
    await enable();
    const created = await call('POST', '/api/menus', 'editor', { menu: { ...createSampleMenu(), title: { he: 'לומייר', en: 'Lumiere' } } });
    const menu = created.json().menu as { id: string; draftVersion: number };
    expect((await call('POST', `/api/menus/${menu.id}/publish`, 'editor', {}, { 'if-match': `"${menu.draftVersion}"` })).statusCode).toBe(200);
    expect((await call('POST', '/api/payments/tables', 'owner', { label: '9', menuId: menu.id })).statusCode).toBe(201);
    const t = ((await call('GET', '/api/payments/tables', 'editor')).json().tables as { label: string; url: string }[]).find((x) => x.label === '9')!;
    const code = new URL(t.url).pathname.split('/').pop();
    const page = await call('GET', `${new URL(t.url).pathname}?lang=en`, 'guest');
    expect(page.body).toContain(`href="http://localhost:5173/m/lumiere?lang=en#table=${code}"`);
    expect(page.body).toContain('Lumiere');
    // The published page's CSP still pins its (now larger) runtime script.
    const published = await call('GET', '/m/lumiere', 'guest');
    const script = /<script>([\s\S]*?)<\/script>/.exec(published.body)![1]!;
    const hash = createHash('sha256').update(script).digest('base64');
    expect(published.headers['content-security-policy']).toContain(`'sha256-${hash}'`);
    expect(script).toContain('initTablePay(document)');
  });

  it('accepts provider notifications without an Origin, but nothing else', async () => {
    await enable();
    expect((await app.inject({ method: 'POST', url: '/api/payments/notify/fake', payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/payments/notify/unknown', payload: {} })).statusCode).toBe(404);
    const t = await table();
    await openBill(t.id, 10000);
    // The exemption can't be carried to another endpoint with a path trick.
    for (const url of ['/api/payments/notify/../users', '/api/payments/notify/%2e%2e/users', '/api/payments/notify/fake/../../payments/settings']) {
      expect((await app.inject({ method: 'POST', url, payload: {}, headers: { cookie: cookies.owner } })).statusCode).toBe(403);
    }
    // A cross-site form post to the checkout is refused (CSRF).
    expect((await form(`${t.path}/pay`, { share: 'full' }, 'https://evil.example')).statusCode).toBe(403);
  });

  it('shows the pages in English and Arabic too', async () => {
    await enable();
    const t = await table();
    await openBill(t.id, 10000);
    expect((await call('GET', `${t.path}?lang=en`, 'guest')).body).toContain('lang="en" dir="ltr"');
    const ar = await call('GET', t.path, 'guest', undefined, { 'accept-language': 'ar,en;q=0.5' });
    expect(ar.body).toContain('lang="ar" dir="rtl"');
    expect(ar.body).toContain('دفع الحساب');
  });

  it('expires abandoned checkouts in the daily retention run', async () => {
    await enable();
    const t = await table();
    await openBill(t.id, 10000);
    const { paymentId } = await checkout(t.path, { share: 'full' });
    await db.query("UPDATE payments SET created_at = now() - interval '2 days' WHERE id = $1", [paymentId]);
    const report = await applyRetention(db, createMediaStore(mkdtempSync(path.join(tmpdir(), 'menuai-up-'))));
    expect(report.abandonedPayments).toBe(1);
    const [row] = await db.query<{ status: string }>('SELECT status FROM payments WHERE id = $1', [paymentId]);
    expect(row!.status).toBe('expired');
  });

  it('hides the demo provider when it is not allowed', async () => {
    await enable();
    const t = await table();
    await openBill(t.id, 10000);
    const { demoPath } = await checkout(t.path, { share: 'full' });
    await app.close();
    ({ app } = await testApp({ db, config: { PAYMENTS_KEY: KEY } }));
    expect((await call('GET', demoPath, 'guest')).statusCode).toBe(404);
    expect((await call('GET', t.path, 'guest')).body).toContain('תשלום מהשולחן לא זמין');
    expect(testConfig().PAYMENTS_ALLOW_FAKE).toBe(false);
  });
});
