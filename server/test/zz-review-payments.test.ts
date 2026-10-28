import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { ORIGIN, testApp } from './helpers';
import { issueLoginToken, redeemLoginToken } from '../src/auth/service';
import type { SqlClient } from '../src/db/sql';

const KEY = randomBytes(32).toString('base64');
let app: FastifyInstance; let db: SqlClient; const c: Record<string, string> = {};
const call = (method: any, url: string, as: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, headers: { origin: ORIGIN, ...(c[as] ? { cookie: c[as] } : {}) } });
const form = (url: string, f: Record<string, string>) => app.inject({ method: 'POST', url, payload: new URLSearchParams(f).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN } });
beforeEach(async () => {
  ({ app, db } = await testApp({ config: { PAYMENTS_KEY: KEY, PAYMENTS_ALLOW_FAKE: 'true' } }));
  for (const role of ['owner', 'editor']) {
    const [row] = await db.query<{ id: string }>('INSERT INTO users (email, name, role) VALUES ($1,$2,$3) RETURNING id', [`${role}@x.com`, role, role]);
    const s = await redeemLoginToken(db, (await issueLoginToken(db, row!.id, 15))!, 'test');
    c[role] = `menuai_session=${s!.sessionToken}`;
  }
  await call('PUT', '/api/payments/settings', 'owner', { enabled: true, provider: 'fake', mode: 'test', tipPercents: [10] });
});
afterEach(async () => { await app.close(); await db.close(); });

async function setupTable() {
  await call('POST', '/api/payments/tables', 'owner', { label: '7' });
  const t = (await call('GET', '/api/payments/tables', 'editor')).json().tables[0];
  const billId = (await call('POST', '/api/payments/bills', 'editor', { tableId: t.id, amountAgorot: 10000 })).json().id;
  return { path: new URL(t.url).pathname, billId };
}
const co = async (p: string) => new URL((await form(`${p}/pay`, { share: 'full' })).headers.location as string).pathname;

it('double payment after reservation lapses', async () => {
  const { path, billId } = await setupTable();
  const a = await co(path);
  await db.query("UPDATE payments SET created_at = now() - interval '21 minutes'");
  const b = await co(path);
  await form(b, { outcome: 'paid' });
  await form(a, { outcome: 'paid' });
  const bill = (await call('GET', '/api/payments/bills?view=recent', 'editor')).json().bills.find((x: any) => x.id === billId);
  console.log('DOUBLE', bill.status, bill.amountAgorot, bill.paidAgorot);
});

it('pay on a cancelled bill', async () => {
  const { path, billId } = await setupTable();
  const a = await co(path);
  await db.query("UPDATE payments SET created_at = now() - interval '21 minutes'");
  console.log('CANCEL', (await call('POST', `/api/payments/bills/${billId}/cancel`, 'editor')).statusCode);
  await form(a, { outcome: 'paid' });
  const bill = (await call('GET', '/api/payments/bills?view=recent', 'editor')).json().bills.find((x: any) => x.id === billId);
  console.log('CANCELLED', bill.status, bill.paidAgorot);
});

it('bad uuid', async () => {
  const { path } = await setupTable();
  const r = await app.inject({ method: 'POST', url: '/api/payments/notify/fake', payload: { paymentId: '-'.repeat(36), demoSecret: 'x' } });
  console.log('NOTIFY', r.statusCode, r.body);
  const r2 = await call('GET', `${path}/done/${'-'.repeat(36)}`, 'guest');
  console.log('DONE', r2.statusCode);
  const r3 = await form(`${path}/pay`, { share: 'split', parts: 'abc' });
  console.log('NAN', r3.statusCode, /NaN/.test(r3.body));
});
