/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * Grow (formerly Meshulam) "Light API" adapter: https://developers.grow.business
 *
 * Flow (per Grow's docs):
 *   1. createPaymentProcess (server → Grow, multipart/form-data) → a hosted payment page URL.
 *   2. The guest pays on Grow's page (card / Bit / wallets). Card data never reaches us.
 *   3. Grow POSTs a server update to notifyUrl (form fields, `data[...]`, NOT JSON). It is unsigned,
 *      so it is only a hint: it must carry the processToken we stored, and the status is confirmed
 *      with getPaymentProcessInfo (server → Grow) before anything is marked paid.
 *   4. approveTransaction with the fields received in the update (required for every successful
 *      transaction; Grow retries the update for about an hour until it gets one).
 *
 * Grow's docs do not publish the getPaymentProcessInfo response layout, so it is parsed
 * conservatively: anything not clearly "paid (statusCode 2) for the exact amount" stays pending.
 * Live mode stays disabled (PAYMENTS_GROW_LIVE) until this has passed end to end in Grow's sandbox.
 */
import { timingSafeEqual } from 'node:crypto';
import { agorotToDecimal, decimalToAgorot } from '../money';
import { ProviderError, type Notification, type PaymentMode, type PaymentProvider, type ProviderRef, type Session, type SessionRequest, type VerifiedStatus } from './types';

export type Http = typeof fetch;

export const GROW_API = {
  test: 'https://sandbox.meshulam.co.il/api/light/server/1.0/',
  live: 'https://secure.meshulam.co.il/api/light/server/1.0/',
} as const;

/** Where Grow's hosted pages may live (CSP form-action after our checkout redirect, and URL check). */
export const GROW_CHECKOUT_ORIGINS = ['https://*.meshulam.co.il', 'https://*.grow.link', 'https://*.grow.business'];
const CHECKOUT_HOST = /(^|\.)(meshulam\.co\.il|grow\.link|grow\.business)$/i;

/** Grow's statusCode for a completed charge ("שולם"). */
const PAID = '2';
/** Fields Grow expects back in approveTransaction ("all the data received from the server update"). */
const APPROVE_FIELDS = [
  'transactionId', 'transactionToken', 'transactionTypeId', 'paymentType', 'sum', 'firstPaymentSum', 'periodicalPaymentSum',
  'paymentsNum', 'allPaymentsNum', 'paymentDate', 'asmachta', 'description', 'fullName', 'payerPhone', 'payerEmail',
  'cardSuffix', 'cardType', 'cardTypeCode', 'cardBrand', 'cardBrandCode', 'cardExp', 'processId', 'processToken',
] as const;

const TIMEOUT_MS = 15_000;

export interface GrowCredentials {
  userId: string;
  pageCode: string;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);

function sameSecret(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Turns bracketed form keys into an object: `data[customFields][cField1]=x` → { data: { customFields: { cField1: 'x' } } }.
 * Keys are limited to plain identifiers, so `__proto__` and friends can't reach the prototype.
 */
export function unbracket(entries: Iterable<[string, string]>): Json {
  const root: Json = Object.create(null);
  for (const [key, value] of entries) {
    const parts = /^([A-Za-z][A-Za-z0-9_]*)((?:\[[A-Za-z0-9_]+\])*)$/.exec(key);
    if (!parts) continue;
    const path = [parts[1]!, ...[...parts[2]!.matchAll(/\[([A-Za-z0-9_]+)\]/g)].map((m) => m[1]!)];
    if (path.length > 4 || path.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) continue;
    let node = root;
    for (const p of path.slice(0, -1)) {
      if (!isObj(node[p])) node[p] = Object.create(null);
      node = node[p] as Json;
    }
    node[path.at(-1)!] ??= value;
  }
  return root;
}

export function growProvider(credentials: GrowCredentials, mode: PaymentMode, http: Http = fetch): PaymentProvider {
  const base = GROW_API[mode];

  async function call(method: string, fields: Record<string, string>): Promise<Json> {
    const body = new FormData();
    body.set('pageCode', credentials.pageCode);
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    let res: Response;
    try {
      res = await http(new URL(method, base), { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    } catch {
      throw new ProviderError(`grow ${method}: network`);
    }
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok || !isObj(json)) throw new ProviderError(`grow ${method}: http ${res.status}`);
    if (String(json.status) !== '1') {
      const code = isObj(json.err) ? str(json.err.id) : undefined;
      // Only the code goes into the error (Grow's message can echo request fields).
      throw new ProviderError(`grow ${method}: error ${code ?? 'unknown'}`, false);
    }
    return json;
  }

  return {
    id: 'grow',
    checkoutOrigins: GROW_CHECKOUT_ORIGINS,
    requiresPayer: true,

    async createSession(req: SessionRequest): Promise<Session> {
      const json = await call('createPaymentProcess', {
        userId: credentials.userId,
        chargeType: '1',
        sum: agorotToDecimal(req.amountAgorot),
        successUrl: req.successUrl,
        cancelUrl: req.cancelUrl,
        notifyUrl: req.notifyUrl,
        description: req.description,
        'pageField[fullName]': req.payer.fullName,
        'pageField[phone]': req.payer.phone,
        // Echoed back in the server update: tells us which payment it is about (still verified).
        cField1: req.paymentId,
      });
      const data = isObj(json.data) ? json.data : {};
      const url = str(data.url);
      const processId = str(data.processId);
      const processToken = str(data.processToken);
      if (!url || !processId || !processToken) throw new ProviderError('grow createPaymentProcess: incomplete response');
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new ProviderError('grow createPaymentProcess: bad url');
      }
      // Never redirect a guest anywhere but Grow's own pages.
      if (parsed.protocol !== 'https:' || !CHECKOUT_HOST.test(parsed.hostname)) throw new ProviderError('grow createPaymentProcess: unexpected host');
      return { redirectUrl: parsed.toString(), ref: { processId, processToken, amount: String(req.amountAgorot) } };
    },

    parseNotification(body: unknown): Notification | null {
      if (!isObj(body)) return null;
      // Accept both the flat `data[x]` keys (as posted) and an already-nested object.
      const nested = Object.keys(body).some((k) => k.includes('[')) ? unbracket(Object.entries(body).filter((e): e is [string, string] => typeof e[1] === 'string')) : body;
      const data = isObj(nested.data) ? nested.data : null;
      if (!data) return null;
      const fields: Record<string, string> = {};
      for (const k of APPROVE_FIELDS) {
        const v = str(data[k]);
        if (v !== undefined) fields[k] = v.slice(0, 200);
      }
      if (!fields.processToken || !fields.processId) return null;
      const custom = isObj(data.customFields) ? data.customFields : {};
      return { paymentId: str(custom.cField1), fields };
    },

    matches(ref: ProviderRef, n: Notification): boolean {
      return ref.processId === n.fields.processId && sameSecret(ref.processToken, n.fields.processToken);
    },

    async fetchStatus(ref: ProviderRef): Promise<VerifiedStatus> {
      if (!ref.processId || !ref.processToken) return { status: 'pending' };
      let json: Json;
      try {
        json = await call('getPaymentProcessInfo', { processId: ref.processId, processToken: ref.processToken });
      } catch (err) {
        // A Grow-side "error" for this process (e.g. not paid yet) is not a payment.
        if (err instanceof ProviderError && !err.retryable) return { status: 'pending' };
        throw err;
      }
      // Undocumented layout: look for the transaction record in the usual places.
      const d = json.data;
      const candidates: unknown[] = [d, isObj(d) ? d.transaction : undefined, ...(Array.isArray(d) ? d : []), ...(isObj(d) && Array.isArray(d.transactions) ? d.transactions : [])];
      const paid = candidates.find(
        (c): c is Json => isObj(c) && str(c.statusCode) === PAID && (str(c.processId) === undefined || str(c.processId) === ref.processId),
      );
      if (!paid) return { status: 'pending' };
      const amount = decimalToAgorot(paid.sum);
      return { status: 'paid', amountAgorot: amount ?? undefined, transactionRef: str(paid.asmachta) ?? str(paid.transactionId) };
    },

    async acknowledge(_ref: ProviderRef, n: Notification): Promise<void> {
      // Echo back exactly what Grow sent (it is not stored anywhere on our side).
      await call('approveTransaction', n.fields);
    },
  };
}
