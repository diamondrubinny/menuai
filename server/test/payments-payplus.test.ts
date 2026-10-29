/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
// PayPlus adapter against a simulated PayPlus API that follows PayPlus's documented contract
// (generateLink, signed transaction callback, IPN). The real sandbox run is a separate, manual step.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { ORIGIN, testApp } from './helpers';
import { issueLoginToken, redeemLoginToken } from '../src/auth/service';
import type { SqlClient } from '../src/db/sql';
import { loadConfig } from '../src/config';
import { PAYPLUS_API, payplusSignature } from '../src/payments/providers/payplus';

const KEY = randomBytes(32).toString('base64');
const CREDS = { apiKey: 'test-api-key-0001', secretKey: 'test-secret-key-0001', paymentPageUid: randomUUID() };

interface Call { method: string; headers: Record<string, string>; body: Record<string, unknown> }

function fakePayPlus() {
  const state = {
    calls: [] as Call[],
    pageRequestUid: randomUUID(),
    link: '',
    linkStatus: 'success',
    ipn: null as null | Record<string, unknown>,
  };
  state.link = `https://paymentsdev.payplus.co.il/${state.pageRequestUid}`;
  const http: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin + '/api/v1.0/').toBe(PAYPLUS_API.test);
    const method = url.pathname.replace('/api/v1.0/', '');
    const headers = Object.fromEntries(Object.entries(init!.headers as Record<string, string>));
    state.calls.push({ method, headers, body: JSON.parse(String(init!.body)) });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (method === 'PaymentPages/generateLink') {
      return state.linkStatus === 'success'
        ? json({ results: { status: 'success', code: 0, description: 'payment page link is been generated' }, data: { page_request_uid: state.pageRequestUid, payment_page_link: state.link } })
        : json({ results: { status: 'error', code: 1, description: 'can-not-find-payment-page' } }, 422);
    }
    if (method === 'PaymentPages/ipn') {
      return state.ipn ? json({ results: { status: 'success', code: 0 }, data: state.ipn }) : json({ results: { status: 'error', code: 404 } }, 404);
    }
    return new Response('not found', { status: 404 });
  };
  return { state, http };
}

describe('PayPlus provider', () => {
  let app: FastifyInstance;
  let db: SqlClient;
  let pp: ReturnType<typeof fakePayPlus>;
  let owner = '';

  async function setup(config: Record<string, string> = {}) {
    pp = fakePayPlus();
    ({ app, db } = await testApp({ config: { PAYMENTS_KEY: KEY, ...config }, paymentHttp: pp.http }));
    const [row] = await db.query<{ id: string }>("INSERT INTO users (email, role) VALUES ('owner@example.com', 'owner') RETURNING id");
    owner = `menuai_session=${(await redeemLoginToken(db, (await issueLoginToken(db, row!.id, 15))!, 'test'))!.sessionToken}`;
  }
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as object, headers: { origin: ORIGIN, cookie: owner } });
  const form = (url: string, fields: Record<string, string>) =>
    app.inject({ method: 'POST', url, payload: new URLSearchParams(fields).toString(), headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' } });

  async function ready(amountAgorot = 28450) {
    expect((await call('PUT', '/api/payments/settings', { enabled: true, provider: 'payplus', mode: 'test', tipPercents: [10, 12], credentials: CREDS })).statusCode).toBe(200);
    await call('POST', '/api/payments/tables', { label: '7' });
    const t = (await call('GET', '/api/payments/tables')).json().tables[0] as { id: string; url: string };
    await call('POST', '/api/payments/bills', { tableId: t.id, amountAgorot });
    return new URL(t.url).pathname;
  }

  async function checkout(path: string, fields: Record<string, string>) {
    const res = await form(`${path}/pay`, fields);
    expect(res.statusCode, res.body).toBe(303);
    expect(res.headers.location).toBe(pp.state.link);
    return pp.state.calls.filter((c) => c.method === 'PaymentPages/generateLink').at(-1)!.body.more_info as string;
  }

  /** PayPlus's transaction callback, including card/ID details we must never keep. */
  const callbackBody = (paymentId: string, over: Record<string, unknown> = {}) => ({
    transaction_type: 'Charge',
    transaction: {
      uid: randomUUID(), payment_request_uid: pp.state.pageRequestUid, number: 'fd138', type: 'internal_page',
      date: '2026-10-29 12:32:52', status_code: '000',
      amount: Number((pp.state.calls.find((c) => c.method === 'PaymentPages/generateLink')!.body.amount as number).toFixed(2)),
      currency: 'ILS', credit_terms: 'regular', approval_number: '002341', voucher_number: '15-901-901', more_info: paymentId,
      ...over,
    },
    data: { card_information: { card_holder_name: 'Moshe Cohen', four_digits: '6134', identification_number: '123456789' } },
  });

  /** Sends a callback as PayPlus does: compact JSON, `hash` + `user-agent` headers, no Origin or cookies. */
  function notify(body: unknown, opts: { secret?: string; userAgent?: string; tamper?: (raw: string) => string } = {}) {
    const raw = JSON.stringify(body);
    const sent = opts.tamper ? opts.tamper(raw) : raw;
    return app.inject({
      method: 'POST', url: '/api/payments/notify/payplus', payload: sent,
      headers: { 'content-type': 'application/json', hash: payplusSignature(opts.secret ?? CREDS.secretKey, raw), 'user-agent': opts.userAgent ?? 'PayPlus' },
    });
  }

  const paidAgorot = async () => Number((await db.query<{ s: string }>("SELECT COALESCE(sum(share_agorot), 0) AS s FROM payments WHERE status = 'paid'"))[0]!.s);

  beforeEach(async () => setup());
  afterEach(async () => {
    await app.close();
    await db.close();
  });

  it('needs all three account details, stores them encrypted, and keeps live mode locked', async () => {
    expect((await call('PUT', '/api/payments/settings', { enabled: true, provider: 'payplus', mode: 'test', tipPercents: [] })).json()).toEqual({ error: 'credentials_required' });
    expect((await call('PUT', '/api/payments/settings', { enabled: true, provider: 'payplus', mode: 'test', tipPercents: [], credentials: { apiKey: 'x', secretKey: 'y' } })).json()).toEqual({ error: 'invalid_credentials' });
    expect((await call('PUT', '/api/payments/settings', { enabled: true, provider: 'payplus', mode: 'live', tipPercents: [], credentials: CREDS })).json()).toEqual({ error: 'live_not_enabled' });
    expect((await call('PUT', '/api/payments/settings', { enabled: true, provider: 'payplus', mode: 'test', tipPercents: [], credentials: CREDS })).statusCode).toBe(200);
    const [row] = await db.query<{ credentials_enc: string }>('SELECT credentials_enc FROM payment_settings');
    expect(row!.credentials_enc).not.toContain(CREDS.secretKey);
    const settings = (await call('GET', '/api/payments/settings')).json();
    expect(JSON.stringify(settings)).not.toContain(CREDS.secretKey);
    expect(settings.providers).toContainEqual({ id: 'payplus', credentialFields: ['apiKey', 'secretKey', 'paymentPageUid'], liveAllowed: false });
  });

  it('reads the live allow-list from PAYMENTS_LIVE_PROVIDERS', () => {
    const base = { NODE_ENV: 'test', DATABASE_URL: 'postgres://x/y', PUBLIC_URL: 'http://localhost:5173' };
    expect(loadConfig({ ...base, PAYMENTS_LIVE_PROVIDERS: ' Grow, payplus ' }).PAYMENTS_LIVE_PROVIDERS).toEqual(['grow', 'payplus']);
    expect(loadConfig(base).PAYMENTS_LIVE_PROVIDERS).toEqual([]);
    expect(() => loadConfig({ ...base, PAYMENTS_LIVE_PROVIDERS: 'fake' })).toThrow(/PAYMENTS_LIVE_PROVIDERS/);
  });

  it('creates a payment link with exactly what PayPlus needs, expiring with the reservation', async () => {
    const path = await ready();
    const page = await app.inject({ method: 'GET', url: path });
    expect(page.headers['content-security-policy']).toContain("form-action 'self' https://*.payplus.co.il");
    expect(page.body).not.toContain('name="fullName"'); // PayPlus's page asks for what it needs itself
    const paymentId = await checkout(path, { share: 'split', parts: '2', tip: '12' });
    const sent = pp.state.calls[0]!;
    expect(sent.headers).toMatchObject({ 'api-key': CREDS.apiKey, 'secret-key': CREDS.secretKey, 'content-type': 'application/json' });
    expect(sent.body).toMatchObject({
      payment_page_uid: CREDS.paymentPageUid, charge_method: 1, amount: 159.32, currency_code: 'ILS', language_code: 'he',
      expiry_datetime: '20', sendEmailApproval: false, sendEmailFailure: false, more_info: paymentId,
      refURL_callback: 'http://localhost:5173/api/payments/notify/payplus',
    });
    expect(sent.body.refURL_success).toBe(`http://localhost:5173${path}/done/${paymentId}?lang=he`);
  });

  it('refuses a payment page outside PayPlus and PayPlus errors, without keeping a reservation', async () => {
    const path = await ready(10000);
    pp.state.link = 'https://evil.example/pay';
    expect((await form(`${path}/pay`, { share: 'full' })).statusCode).toBe(502);
    pp.state.link = `https://paymentsdev.payplus.co.il/${pp.state.pageRequestUid}`;
    pp.state.linkStatus = 'error';
    expect((await form(`${path}/pay`, { share: 'full' })).statusCode).toBe(502);
    pp.state.linkStatus = 'success';
    await checkout(path, { share: 'full' });
  });

  it('records a payment from a correctly signed callback, and keeps none of its personal details', async () => {
    const path = await ready(28450);
    const paymentId = await checkout(path, { share: 'full' });
    const res = await notify(callbackBody(paymentId));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'paid' });
    expect(await paidAgorot()).toBe(28450);
    // Signed: no extra status call was needed.
    expect(pp.state.calls.map((c) => c.method)).toEqual(['PaymentPages/generateLink']);
    const dump = JSON.stringify([await db.query('SELECT * FROM payments'), await db.query('SELECT * FROM payment_events'), await db.query('SELECT * FROM audit_log')]);
    for (const secret of ['Moshe', '123456789', '6134']) expect(dump).not.toContain(secret);
    const [row] = await db.query<{ provider_txn: string }>('SELECT provider_txn FROM payments WHERE id = $1', [paymentId]);
    expect(row!.provider_txn).toBe('002341');
    // A repeated callback changes nothing.
    expect((await notify(callbackBody(paymentId))).json()).toMatchObject({ outcome: 'paid' });
    expect(await paidAgorot()).toBe(28450);
  });

  it('ignores callbacks with a wrong or missing signature, a changed body, or another payment page', async () => {
    const path = await ready(10000);
    const paymentId = await checkout(path, { share: 'full' });
    expect((await notify(callbackBody(paymentId), { secret: 'wrong-secret' })).json()).toMatchObject({ outcome: 'ignored' });
    expect((await notify(callbackBody(paymentId), { userAgent: 'curl/8' })).json()).toMatchObject({ outcome: 'ignored' });
    expect((await notify(callbackBody(paymentId), { tamper: (raw) => raw.replace('"status_code":"000"', '"status_code":"000" ') })).json()).toMatchObject({ outcome: 'ignored' });
    expect((await notify(callbackBody(paymentId, { payment_request_uid: randomUUID() }))).json()).toMatchObject({ outcome: 'ignored' });
    const unsigned = await app.inject({ method: 'POST', url: '/api/payments/notify/payplus', payload: callbackBody(paymentId), headers: { 'user-agent': 'PayPlus' } });
    expect(unsigned.json()).toMatchObject({ outcome: 'ignored' });
    expect(await paidAgorot()).toBe(0);
  });

  it('never accepts a different amount, and a declined callback releases the share', async () => {
    const path = await ready(10000);
    const paymentId = await checkout(path, { share: 'full' });
    expect((await notify(callbackBody(paymentId, { amount: 1 }))).json()).toMatchObject({ outcome: 'amount_mismatch' });
    expect(await paidAgorot()).toBe(0);
    expect((await notify(callbackBody(paymentId, { status_code: '006' }))).json()).toMatchObject({ outcome: 'failed' });
    await checkout(path, { share: 'full' }); // nothing stays reserved
  });

  it('confirms through the IPN when the guest returns before the callback, conservatively', async () => {
    const path = await ready(10000);
    const paymentId = await checkout(path, { share: 'full' });
    // No IPN record yet → still confirming.
    expect((await app.inject({ method: 'GET', url: `${path}/done/${paymentId}` })).body).toContain('מאמתים');
    // A record for another page request does not count.
    pp.state.ipn = { status_code: '000', amount: 100, payment_request_uid: randomUUID() };
    expect((await app.inject({ method: 'GET', url: `${path}/done/${paymentId}` })).body).toContain('מאמתים');
    pp.state.ipn = { status_code: '000', amount: 100, payment_request_uid: pp.state.pageRequestUid, approval_number: 'A1' };
    expect((await app.inject({ method: 'GET', url: `${path}/done/${paymentId}` })).body).toContain('התשלום התקבל');
    expect(await paidAgorot()).toBe(10000);
    const ipn = pp.state.calls.find((c) => c.method === 'PaymentPages/ipn')!;
    expect(ipn.body).toEqual({ payment_request_uid: pp.state.pageRequestUid });
  });
});
