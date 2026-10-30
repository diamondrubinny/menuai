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
    refundStatus: 1,
    refundDown: false,
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
      case 'refundTransaction':
        if (state.refundDown) throw new TypeError('fetch failed');
        return state.refundStatus === 1 ? json({ status: 1, err: '', data: {} }) : json({ status: 0, err: { id: 811, message: 'אין יתרה' }, data: '' });
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

  it('unlocks live mode only when listed in PAYMENTS_LIVE_PROVIDERS, and then talks to the production API', async () => {
    await app.close();
    await db.close();
    await setup({ PAYMENTS_LIVE_PROVIDERS: 'grow' });
    expect((await call('PUT', '/api/payments/settings', { enabled: true, provider: 'grow', mode: 'live', tipPercents: [], credentials: CREDS })).statusCode).toBe(200);
    const live: GrowCall[] = [];
    const { app: app2 } = await testApp({
      db, config: { PAYMENTS_KEY: KEY, PAYMENTS_LIVE_PROVIDERS: 'grow' },
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
    // Receipts come to a per-payment address with a random key (Grow's receipt callback is unsigned).
    expect(sent.invoiceNotifyUrl).toMatch(new RegExp(`^http://localhost:5173/api/payments/receipt/grow/${paymentId}/[0-9a-f]{32}$`));
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
    // Only Grow's identifiers are kept: the process, and what a refund needs (never payer or card details).
    expect(Object.keys(row!.provider_ref).sort()).toEqual(['amount', 'processId', 'processToken', 'receiptKey', 'transactionId', 'transactionToken']);
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

  describe('refunds', () => {
    async function paid(amountAgorot = 28450) {
      const path = await ready(amountAgorot);
      const paymentId = await checkout(path, { share: 'full' });
      expect((await notify(update(paymentId))).json()).toMatchObject({ outcome: 'paid' });
      return paymentId;
    }
    const refund = (id: string, amountAgorot: number) => call('POST', `/api/payments/payments/${id}/refund`, { amountAgorot });
    const yesterday = (id: string) => db.query("UPDATE payments SET paid_at = now() - interval '1 day' WHERE id = $1", [id]);

    it('sends Grow exactly what refundTransaction needs, from the stored transaction handles', async () => {
      const id = await paid();
      const res = await refund(id, 28450);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ status: 'succeeded' });
      const sent = grow.state.calls.at(-1)!;
      expect(sent.method).toBe('refundTransaction');
      expect(sent.fields).toEqual({ pageCode: CREDS.pageCode, userId: CREDS.userId, transactionId: '145111110', transactionToken: 'c68d98d4c3f19b30', refundSum: '284.50' });
    });

    it('follows Grow\'s rules: the whole amount on the day of the charge, and at most 2 refunds', async () => {
      const id = await paid(30000);
      expect((await refund(id, 10000)).json()).toEqual({ error: 'refund_partial_same_day' });
      await yesterday(id);
      expect((await refund(id, 10000)).json()).toMatchObject({ status: 'succeeded' });
      expect((await refund(id, 10000)).json()).toMatchObject({ status: 'succeeded' });
      expect((await refund(id, 10000)).json()).toEqual({ error: 'refund_limit' });
      expect(grow.state.calls.filter((c) => c.method === 'refundTransaction')).toHaveLength(2);
    });

    it('records Grow refusing a refund as failed (code only), and a lost connection as unknown, never retried', async () => {
      const id = await paid();
      grow.state.refundStatus = 0;
      expect((await refund(id, 28450)).json()).toMatchObject({ status: 'failed' });
      const [failed] = await db.query<{ error_code: string }>("SELECT error_code FROM payment_refunds WHERE status = 'failed'");
      expect(failed!.error_code).toBe('grow refundTransaction: error 811');
      grow.state.refundStatus = 1;
      grow.state.refundDown = true;
      expect((await refund(id, 28450)).json()).toMatchObject({ status: 'unknown' });
      grow.state.refundDown = false;
      // It may have gone through: nothing more until the owner checks Grow's dashboard and confirms.
      expect((await refund(id, 28450)).json()).toEqual({ error: 'refund_in_progress' });
      expect(grow.state.calls.filter((c) => c.method === 'refundTransaction')).toHaveLength(2);
    });

    it('refuses when the transaction handles are missing (e.g. the payment was confirmed without an update)', async () => {
      const id = await paid();
      await db.query("UPDATE payments SET provider_ref = provider_ref - 'transactionToken' WHERE id = $1", [id]);
      expect((await refund(id, 28450)).json()).toEqual({ error: 'refund_reference_missing' });
      expect(await db.query('SELECT 1 FROM payment_refunds')).toHaveLength(0);
    });
  });

  describe('receipts', () => {
    async function paidWithReceiptUrl() {
      const path = await ready(28450);
      const paymentId = await checkout(path, { share: 'full' });
      expect((await notify(update(paymentId))).json()).toMatchObject({ outcome: 'paid' });
      const url = grow.state.calls.find((c) => c.method === 'createPaymentProcess')!.fields.invoiceNotifyUrl!;
      return { path, paymentId, receiptPath: new URL(url).pathname };
    }
    const doc = 'https://meshulam.co.il/s/9aaa8395-1111-bd6b-2df2-2d41354814b1';
    const json = (url: string, body: unknown) => app.inject({ method: 'POST', url, payload: body as object, headers: { 'content-type': 'application/json' } });
    const receipt = async (id: string) => (await db.query<{ receipt_number: string | null; receipt_url: string | null }>('SELECT receipt_number, receipt_url FROM payments WHERE id = $1', [id]))[0]!;

    it('keeps the receipt Grow posts to the payment\'s own address, and shows it to the guest and staff', async () => {
      const { path, paymentId, receiptPath } = await paidWithReceiptUrl();
      // No Origin, no cookie: a server-to-server call, like the payment notification.
      const res = await json(receiptPath, [{ transactionId: '145111110', processId: '5001', invoiceNumber: '4111', invoiceUrl: doc }]);
      expect(res.statusCode).toBe(200);
      expect(await receipt(paymentId)).toEqual({ receipt_number: '4111', receipt_url: doc });
      const done = await app.inject({ method: 'GET', url: `${path}/done/${paymentId}` });
      expect(done.body).toContain(`<a class="btn" href="${doc}" target="_blank" rel="noopener noreferrer">🧾 לקבלה`);
      const bills = (await call('GET', '/api/payments/bills?view=recent')).json().bills as { payments: { receiptNumber: string; receiptUrl: string }[] }[];
      expect(bills[0]!.payments[0]).toMatchObject({ receiptNumber: '4111', receiptUrl: doc });
      // The first receipt stays; a later one can't replace it.
      await json(receiptPath, { transactionId: '145111110', processId: '5001', invoiceNumber: '9999', invoiceUrl: `${doc}x` });
      expect((await receipt(paymentId)).receipt_number).toBe('4111');
      expect(await db.query("SELECT outcome FROM payment_events WHERE kind = 'receipt' ORDER BY id")).toEqual([{ outcome: 'stored' }, { outcome: 'duplicate' }]);
    });

    it('accepts form fields too (the format is not documented)', async () => {
      const { paymentId, receiptPath } = await paidWithReceiptUrl();
      const res = await app.inject({
        method: 'POST', url: receiptPath, headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ 'data[transactionId]': '145111110', 'data[processId]': '5001', 'data[invoiceNumber]': '4112', 'data[invoiceUrl]': doc }).toString(),
      });
      expect(res.statusCode).toBe(200);
      expect((await receipt(paymentId)).receipt_number).toBe('4112');
    });

    it('ignores receipts with a wrong key, another process or transaction, or a link outside Grow', async () => {
      const { paymentId, receiptPath } = await paidWithReceiptUrl();
      const wrongKey = receiptPath.replace(/[0-9a-f]{32}$/, '0'.repeat(32));
      const good = { transactionId: '145111110', processId: '5001', invoiceNumber: '1', invoiceUrl: doc };
      for (const [url, body] of [
        [wrongKey, good],
        [receiptPath, { ...good, processId: '5002' }],
        [receiptPath, { ...good, transactionId: '999' }],
        [receiptPath, { ...good, invoiceUrl: 'https://evil.example/s/1' }],
        [receiptPath, { ...good, invoiceUrl: 'http://meshulam.co.il/s/1' }],
        [receiptPath, { ...good, invoiceUrl: 'javascript:alert(1)' }],
        [receiptPath, { invoiceUrl: doc }],
        [receiptPath.replace(paymentId, '00000000-0000-4000-8000-000000000000'), good],
      ] as const) {
        const res = await json(url, body);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });
      }
      expect((await json(receiptPath.replace(/[0-9a-f]{32}$/, 'nothex'), good)).statusCode).toBe(404);
      expect(await receipt(paymentId)).toEqual({ receipt_number: null, receipt_url: null });
    });
  });
});
