/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
// Grow (Meshulam) adapter against a simulated Grow API that follows Grow's documented contract.
// The real sandbox run is a separate, manual step (docs/PAYMENTS.md) before live mode is unlocked.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { ORIGIN, testApp } from './helpers';
import { issueLoginToken, redeemLoginToken } from '../src/auth/service';
import type { SqlClient } from '../src/db/sql';
import { GROW_API, unbracket } from '../src/payments/providers/grow';

const KEY = randomBytes(32).toString('base64');
const CREDS = { userId: 'test-user-0001', pageCode: 'test-page-0001' };

interface GrowCall { method: string; fields: Record<string, string> }

/** A stand-in for Grow's Light API. Behaviour per test via `grow.*`. */
function fakeGrow() {
  const state = {
    calls: [] as GrowCall[],
    processToken: randomBytes(16).toString('hex'),
    payUrl: 'https://sandbox.meshulam.co.il/s/demo-page',
    createStatus: 1,
    infoStatusCode: '2' as string,
    infoSum: null as string | null, // defaults to the requested sum
    approveFails: false,
    down: false,
  };
  const http: typeof fetch = async (input, init) => {
    if (state.down) throw new TypeError('fetch failed');
    const url = new URL(String(input instanceof Request ? input.url : input));
    expect(url.origin + '/api/light/server/1.0/').toBe(GROW_API.test);
    const method = url.pathname.split('/').pop()!;
    const fields: Record<string, string> = {};
    for (const [k, v] of (init!.body as FormData).entries()) fields[k] = String(v);
    state.calls.push({ method, fields });
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    const created = state.calls.find((c) => c.method === 'createPaymentProcess');
    switch (method) {
      case 'createPaymentProcess':
        return state.createStatus === 1
          ? json({ status: 1, err: '', data: { processId: '5001', processToken: state.processToken, url: state.payUrl } })
          : json({ status: 0, err: { id: 701, message: 'פרמטר קוד זיהוי אינו תקין' }, data: '' });
      case 'getPaymentProcessInfo':
        return json({ status: 1, err: '', data: { statusCode: state.infoStatusCode, sum: state.infoSum ?? created?.fields.sum, processId: '5001', asmachta: '0289199', transactionId: '145111110' } });
      case 'approveTransaction':
        return state.approveFails ? json({ status: 0, err: { id: 722, message: 'x' }, data: '' }) : json({ status: 1, err: '', data: '' });
      default:
        return new Response('not found', { status: 404 });
    }
  };
  return { state, http };
}

describe('Grow (Meshulam) provider', () => {
  let app: FastifyInstance;
  let db: SqlClient;
  let grow: ReturnType<typeof fakeGrow>;
  let owner = '';

  async function setup(config: Record<string, string> = {}) {
    grow = fakeGrow();
    ({ app, db } = await testApp({ config: { PAYMENTS_KEY: KEY, ...config }, paymentHttp: grow.http }));
    const [row] = await db.query<{ id: string }>("INSERT INTO users (email, role) VALUES ('owner@example.com', 'owner') RETURNING id");
    owner = `menuai_session=${(await redeemLoginToken(db, (await issueLoginToken(db, row!.id, 15))!, 'test'))!.sessionToken}`;
  }
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as object, headers: { origin: ORIGIN, cookie: owner } });
  const form = (url: string, fields: Record<string, string>) =>
    app.inject({ method: 'POST', url, payload: new URLSearchParams(fields).toString(), headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' } });

  /** Grow's server update: multipart/form-data with data[...] keys, no Origin, no cookies. */
  async function notify(data: Record<string, string>) {
    const fd = new FormData();
    fd.set('status', '1');
    fd.set('err', '');
    for (const [k, v] of Object.entries(data)) fd.set(k.startsWith('customFields.') ? `data[customFields][${k.slice(13)}]` : `data[${k}]`, v);
    const req = new Request('http://x/', { method: 'POST', body: fd });
    return app.inject({
      method: 'POST', url: '/api/payments/notify/grow',
      payload: Buffer.from(await req.arrayBuffer()), headers: { 'content-type': req.headers.get('content-type')! },
    });
  }

  async function ready(amountAgorot = 28450) {
    expect((await call('PUT', '/api/payments/settings', { enabled: true, provider: 'grow', mode: 'test', tipPercents: [10, 12], credentials: CREDS })).statusCode).toBe(200);
    await call('POST', '/api/payments/tables', { label: '7' });
    const t = (await call('GET', '/api/payments/tables')).json().tables[0] as { id: string; url: string };
    await call('POST', '/api/payments/bills', { tableId: t.id, amountAgorot });
    return new URL(t.url).pathname;
  }

  const payer = { fullName: 'ישראל ישראלי', phone: '050-123-4567' };

  /** Guest checkout → returns our payment id (echoed to Grow as cField1). */
  async function checkout(path: string, fields: Record<string, string>) {
    const res = await form(`${path}/pay`, { ...payer, ...fields });
    expect(res.statusCode, res.body).toBe(303);
    expect(res.headers.location).toBe(grow.state.payUrl);
    return grow.state.calls.filter((c) => c.method === 'createPaymentProcess').at(-1)!.fields.cField1!;
  }

  /** What Grow's update would carry for the latest process (with a payer we must never store). */
  const update = (paymentId: string, over: Record<string, string> = {}) => ({
    statusCode: '2', status: 'שולם', sum: grow.state.calls.find((c) => c.method === 'createPaymentProcess')!.fields.sum!,
    transactionId: '145111110', transactionToken: 'c68d98d4c3f19b30', transactionTypeId: '1', paymentType: '2',
    firstPaymentSum: '0', periodicalPaymentSum: '0', paymentsNum: '0', allPaymentsNum: '1', paymentDate: '28/10/26',
    asmachta: '0289199', description: 'Lumiere table 7', fullName: 'ישראל ישראלי', payerPhone: '0501234567',
    payerEmail: 'guest@example.com', cardSuffix: '1177', cardType: 'Local', cardTypeCode: '1', cardBrand: 'Mastercard',
    cardBrandCode: '2', cardExp: '0128', processId: '5001', processToken: grow.state.processToken,
    'customFields.cField1': paymentId, ...over,
  });

  const paidAgorot = async () => Number((await db.query<{ s: string }>("SELECT COALESCE(sum(share_agorot), 0) AS s FROM payments WHERE status = 'paid'"))[0]!.s);

  beforeEach(async () => setup());
  afterEach(async () => {
    await app.close();
    await db.close();
  });

  it('needs credentials to turn on, stores them encrypted, and keeps live mode locked', async () => {
    expect((await call('PUT', '/api/payments/settings', { enabled: true, provider: 'grow', mode: 'test', tipPercents: [] })).json()).toEqual({ error: 'credentials_required' });
    expect((await call('PUT', '/api/payments/settings', { enabled: true, provider: 'grow', mode: 'test', tipPercents: [], credentials: { userId: 'x' } })).json()).toEqual({ error: 'invalid_credentials' });
    expect((await call('PUT', '/api/payments/settings', { enabled: true, provider: 'grow', mode: 'live', tipPercents: [], credentials: CREDS })).json()).toEqual({ error: 'live_not_enabled' });
    expect((await call('PUT', '/api/payments/settings', { enabled: true, provider: 'grow', mode: 'test', tipPercents: [], credentials: CREDS })).statusCode).toBe(200);
    const [row] = await db.query<{ credentials_enc: string }>('SELECT credentials_enc FROM payment_settings');
    expect(row!.credentials_enc).toMatch(/^v1\./);
    expect(row!.credentials_enc).not.toContain(CREDS.userId);
    const settings = (await call('GET', '/api/payments/settings')).json();
    expect(JSON.stringify(settings)).not.toContain(CREDS.pageCode);
    expect(settings.providers).toContainEqual({ id: 'grow', credentialFields: ['userId', 'pageCode'], liveAllowed: false });
    expect((await call('GET', '/api/payments/status')).json()).toMatchObject({ enabled: true, provider: 'grow', mode: 'test' });
  });

  it('unlocks live mode only with PAYMENTS_GROW_LIVE, and then talks to the production API', async () => {
    await app.close();
    await db.close();
    await setup({ PAYMENTS_GROW_LIVE: 'true' });
    expect((await call('PUT', '/api/payments/settings', { enabled: true, provider: 'grow', mode: 'live', tipPercents: [], credentials: CREDS })).statusCode).toBe(200);
    const live: GrowCall[] = [];
    const { app: app2 } = await testApp({
      db, config: { PAYMENTS_KEY: KEY, PAYMENTS_GROW_LIVE: 'true' },
      paymentHttp: async (input) => {
        live.push({ method: String(input), fields: {} });
        return new Response(JSON.stringify({ status: 0, err: { id: 12 } }));
      },
    });
    await call('POST', '/api/payments/tables', { label: '7' });
    const t = (await call('GET', '/api/payments/tables')).json().tables[0] as { id: string; url: string };
    await call('POST', '/api/payments/bills', { tableId: t.id, amountAgorot: 1000 });
    await app2.inject({ method: 'POST', url: `${new URL(t.url).pathname}/pay`, payload: new URLSearchParams({ share: 'full', ...payer }).toString(), headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' } });
    expect(live[0]!.method).toBe(`${GROW_API.live}createPaymentProcess`);
    await app2.close();
  });

  it('creates the payment process with exactly what Grow needs, and sends the guest only to Grow', async () => {
    const path = await ready();
    const page = await app.inject({ method: 'GET', url: path });
    expect(page.headers['content-security-policy']).toContain("form-action 'self' https://*.meshulam.co.il");
    expect(page.body).toContain('autocomplete="name"');

    expect((await form(`${path}/pay`, { share: 'full' })).body).toContain('נא למלא שם מלא');
    expect((await form(`${path}/pay`, { share: 'full', fullName: 'ישראל', phone: '0501234567' })).statusCode).toBe(400);
    expect((await form(`${path}/pay`, { share: 'full', fullName: 'ישראל ישראלי', phone: '021234567' })).statusCode).toBe(400);

    const paymentId = await checkout(path, { share: 'split', parts: '2', tip: '12' });
    const sent = grow.state.calls.find((c) => c.method === 'createPaymentProcess')!.fields;
    expect(sent).toMatchObject({
      pageCode: CREDS.pageCode, userId: CREDS.userId, chargeType: '1',
      sum: '159.32', // ₪142.25 + 12% tip, as a decimal string
      'pageField[fullName]': 'ישראל ישראלי', 'pageField[phone]': '0501234567', cField1: paymentId,
      notifyUrl: 'http://localhost:5173/api/payments/notify/grow',
    });
    expect(sent.successUrl).toBe(`http://localhost:5173${path}/done/${paymentId}?lang=he`);
    expect(sent.description).toMatch(/^[\p{L}\p{N} ]+$/u);
    // The payer's details went to Grow, and nowhere into our database.
    const dump = JSON.stringify(await db.query('SELECT * FROM payments'));
    expect(dump).not.toContain('ישראלי');
    expect(dump).not.toContain('0501234567');
  });

  it('refuses a payment page outside Grow, and Grow errors, without keeping a reservation', async () => {
    const path = await ready(10000);
    grow.state.payUrl = 'https://evil.example/pay';
    const res = await form(`${path}/pay`, { ...payer, share: 'full' });
    expect(res.statusCode).toBe(502);
    expect(res.body).toContain('חברת הסליקה לא זמינה');
    grow.state.payUrl = 'https://sandbox.meshulam.co.il/s/x';
    grow.state.createStatus = 0;
    expect((await form(`${path}/pay`, { ...payer, share: 'full' })).statusCode).toBe(502);
    grow.state.createStatus = 1;
    await checkout(path, { share: 'full' }); // nothing stayed reserved
  });

  it('records a payment from Grow\'s server update only after getPaymentProcessInfo confirms it, then approves it', async () => {
    const path = await ready(28450);
    const paymentId = await checkout(path, { share: 'full' });
    const res = await notify(update(paymentId));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'paid' });
    expect(await paidAgorot()).toBe(28450);
    expect(grow.state.calls.map((c) => c.method)).toEqual(['createPaymentProcess', 'getPaymentProcessInfo', 'approveTransaction']);
    const approve = grow.state.calls.at(-1)!.fields;
    expect(approve).toMatchObject({ pageCode: CREDS.pageCode, transactionId: '145111110', transactionToken: 'c68d98d4c3f19b30', processId: '5001', processToken: grow.state.processToken, sum: '284.50', asmachta: '0289199' });
    expect(approve.cField1).toBeUndefined();
    // The guest returning afterwards sees the confirmation; the asmachta is kept for reconciliation.
    expect((await app.inject({ method: 'GET', url: `${path}/done/${paymentId}?response=success` })).body).toContain('התשלום התקבל');
    const [row] = await db.query<{ provider_txn: string; provider_ref: Record<string, string> }>('SELECT provider_txn, provider_ref FROM payments WHERE id = $1', [paymentId]);
    expect(row!.provider_txn).toBe('0289199');
    expect(Object.keys(row!.provider_ref).sort()).toEqual(['amount', 'processId', 'processToken']);
    // Grow resends the update: still paid once, approved again.
    expect((await notify(update(paymentId))).json()).toMatchObject({ outcome: 'paid' });
    expect(await paidAgorot()).toBe(28450);
    expect(await db.query("SELECT 1 FROM audit_log WHERE action = 'payment.paid'")).toHaveLength(1);
  });

  it('ignores updates that do not carry our process token, and trusts Grow\'s status over the update', async () => {
    const path = await ready(10000);
    const paymentId = await checkout(path, { share: 'full' });
    expect((await notify(update(paymentId, { processToken: 'f'.repeat(32) }))).json()).toMatchObject({ outcome: 'ignored' });
    expect((await notify(update(paymentId, { processId: '9999' }))).json()).toMatchObject({ outcome: 'ignored' });
    expect(grow.state.calls.some((c) => c.method === 'getPaymentProcessInfo')).toBe(false);
    // The update claims "paid", Grow's own record does not.
    grow.state.infoStatusCode = '1';
    expect((await notify(update(paymentId))).json()).toMatchObject({ outcome: 'pending' });
    expect(await paidAgorot()).toBe(0);
    expect(grow.state.calls.some((c) => c.method === 'approveTransaction')).toBe(false);
  });

  it('never accepts a different amount than requested', async () => {
    const path = await ready(10000);
    const paymentId = await checkout(path, { share: 'full' });
    grow.state.infoSum = '1.00';
    expect((await notify(update(paymentId))).json()).toMatchObject({ outcome: 'amount_mismatch' });
    expect(await paidAgorot()).toBe(0);
  });

  it('keeps the payment when approveTransaction fails (Grow resends), and survives Grow being down', async () => {
    const path = await ready(10000);
    const paymentId = await checkout(path, { share: 'full' });
    grow.state.approveFails = true;
    expect((await notify(update(paymentId))).json()).toMatchObject({ outcome: 'paid' });
    expect(await paidAgorot()).toBe(10000);
    const [ev] = await db.query<{ outcome: string }>("SELECT outcome FROM payment_events WHERE outcome = 'ack_failed'");
    expect(ev).toBeDefined();

    const path2 = path; // same table: open a new bill once this one is paid
    await call('POST', '/api/payments/bills', { tableId: (await call('GET', '/api/payments/tables')).json().tables[0].id, amountAgorot: 5000 });
    grow.state.approveFails = false;
    const second = await checkout(path2, { share: 'full' });
    grow.state.down = true;
    const page = await app.inject({ method: 'GET', url: `${path2}/done/${second}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('מאמתים');
    expect((await notify(update(second))).statusCode).toBe(503); // Grow retries later
  });

  it('accepts a urlencoded update too, and parses bracketed keys safely', async () => {
    const path = await ready(10000);
    const paymentId = await checkout(path, { share: 'full' });
    const body = new URLSearchParams(Object.entries(update(paymentId)).map(([k, v]) => [k.startsWith('customFields.') ? `data[customFields][${k.slice(13)}]` : `data[${k}]`, v]));
    const res = await app.inject({ method: 'POST', url: '/api/payments/notify/grow', payload: body.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(res.json()).toMatchObject({ outcome: 'paid' });

    const parsed = unbracket([['data[__proto__][x]', '1'], ['constructor[prototype][y]', '2'], ['data[a][b]', '3'], ['data[a]', 'flat']]);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(({} as Record<string, unknown>).y).toBeUndefined();
    expect(parsed).toEqual({ data: { a: { b: '3' } } });
  });
});
