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
    expect((await call('PUT', '/api/payments/settings', 'owner', { enabled: true, provider: 'grow', mode: 'test', tipPercents: [] })).json()).toEqual({ error: 'provider_unavailable' });
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
