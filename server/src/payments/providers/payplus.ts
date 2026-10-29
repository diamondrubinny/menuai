/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * PayPlus adapter (REST API v1.0): https://docs.payplus.co.il
 *
 * Flow (per PayPlus's docs):
 *   1. PaymentPages/generateLink (server → PayPlus, JSON, `api-key` + `secret-key` headers) → a hosted
 *      payment page link. Card data never reaches us. The page expires with our reservation, so a guest
 *      can't finish paying after their share was released.
 *   2. PayPlus POSTs a transaction callback (JSON) to refURL_callback. It is **signed**: header `hash` =
 *      base64(HMAC-SHA256(secret key, body)) and `user-agent: PayPlus`. Only a callback whose signature
 *      checks out (constant-time) is trusted, and its outcome still has to match the stored payment and
 *      the exact amount. Its card/ID/customer fields are never read.
 *   3. Without a callback (the guest returning first, stale-checkout checks) the status is asked with
 *      PaymentPages/ipn. Its response layout is not published, so it is parsed conservatively: anything
 *      not clearly "approved (status_code 000) for the exact amount" stays pending.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { agorotToDecimal, decimalToAgorot } from '../money';
import { RESERVATION_MINUTES } from '../reservation';
import {
  ProviderError, type Notification, type NotificationContext, type PaymentMode, type PaymentProvider, type ProviderRef, type Session,
  type SessionRequest, type VerifiedStatus,
} from './types';
import type { Http } from './grow';

export const PAYPLUS_API = {
  test: 'https://restapidev.payplus.co.il/api/v1.0/',
  live: 'https://restapi.payplus.co.il/api/v1.0/',
} as const;

export const PAYPLUS_CHECKOUT_ORIGINS = ['https://*.payplus.co.il'];
const CHECKOUT_HOST = /(^|\.)payplus\.co\.il$/i;
/** PayPlus's code for an approved transaction. */
const APPROVED = '000';
const TIMEOUT_MS = 15_000;

export interface PayPlusCredentials {
  apiKey: string;
  secretKey: string;
  /** The payment page configured in the PayPlus dashboard (its UID). */
  paymentPageUid: string;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
const header = (h: NotificationContext['headers'], name: string): string | undefined => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

function sameSecret(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** PayPlus's callback signature: base64(HMAC-SHA256(secret key, exact JSON body)). */
export function payplusSignature(secretKey: string, body: string): string {
  return createHmac('sha256', secretKey).update(body).digest('base64');
}

/** The guest-facing page languages PayPlus is asked for (anything else falls back to Hebrew). */
const PAGE_LANGUAGES = new Set(['he', 'en']);

/** Reads the transaction outcome PayPlus reports (callback or IPN), ignoring every personal field. */
function outcomeOf(transaction: Json): VerifiedStatus {
  const code = str(transaction.status_code);
  if (code !== APPROVED) return { status: code ? 'failed' : 'pending' };
  const amount = decimalToAgorot(transaction.amount);
  return {
    status: 'paid',
    amountAgorot: amount ?? undefined,
    transactionRef: str(transaction.approval_number) ?? str(transaction.number) ?? str(transaction.uid),
  };
}

export function payplusProvider(credentials: PayPlusCredentials, mode: PaymentMode, http: Http = fetch): PaymentProvider {
  const base = PAYPLUS_API[mode];

  async function call(method: string, body: Json): Promise<Json> {
    let res: Response;
    try {
      res = await http(new URL(method, base), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // PayPlus authenticates every server call with both keys (they never leave the server).
          'api-key': credentials.apiKey,
          'secret-key': credentials.secretKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      throw new ProviderError(`payplus ${method}: network`);
    }
    const json = (await res.json().catch(() => null)) as unknown;
    if (res.status >= 500) throw new ProviderError(`payplus ${method}: http ${res.status}`);
    if (!res.ok || !isObj(json)) throw new ProviderError(`payplus ${method}: http ${res.status}`, false);
    const results = isObj(json.results) ? json.results : {};
    if (str(results.status) !== 'success') {
      // Only the numeric code goes into the error (descriptions can echo request data).
      throw new ProviderError(`payplus ${method}: error ${str(results.code) ?? 'unknown'}`, false);
    }
    return json;
  }

  return {
    id: 'payplus',
    checkoutOrigins: PAYPLUS_CHECKOUT_ORIGINS,
    // PayPlus's page collects what it needs itself; we send no personal data.
    requiresPayer: false,

    async createSession(req: SessionRequest): Promise<Session> {
      const json = await call('PaymentPages/generateLink', {
        payment_page_uid: credentials.paymentPageUid,
        charge_method: 1, // Charge (J4): a regular immediate charge
        amount: Number(agorotToDecimal(req.amountAgorot)),
        currency_code: 'ILS',
        language_code: PAGE_LANGUAGES.has(req.locale) ? req.locale : 'he',
        sendEmailApproval: false,
        sendEmailFailure: false,
        // The page closes when our reservation does: no payments after the share was released.
        expiry_datetime: String(RESERVATION_MINUTES),
        refURL_success: req.successUrl,
        refURL_failure: req.cancelUrl,
        refURL_cancel: req.cancelUrl,
        refURL_callback: req.notifyUrl,
        // Echoed back in the callback: which of our payments it is about (still verified).
        more_info: req.paymentId,
        more_info_1: req.description,
      });
      const data = isObj(json.data) ? json.data : {};
      const link = str(data.payment_page_link);
      const pageRequestUid = str(data.page_request_uid);
      if (!link || !pageRequestUid) throw new ProviderError('payplus generateLink: incomplete response');
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        throw new ProviderError('payplus generateLink: bad url');
      }
      // Never send a guest anywhere but PayPlus's own pages.
      if (url.protocol !== 'https:' || !CHECKOUT_HOST.test(url.hostname)) throw new ProviderError('payplus generateLink: unexpected host');
      return { redirectUrl: url.toString(), ref: { pageRequestUid, amount: String(req.amountAgorot) } };
    },

    parseNotification(body: unknown, ctx?: NotificationContext): Notification | null {
      if (!isObj(body) || !ctx?.rawBody) return null;
      if (header(ctx.headers, 'user-agent') !== 'PayPlus') return null;
      const expected = payplusSignature(credentials.secretKey, ctx.rawBody);
      if (!sameSecret(header(ctx.headers, 'hash'), expected)) return null;
      const transaction = isObj(body.transaction) ? body.transaction : null;
      if (!transaction) return null;
      const pageRequestUid = str(transaction.payment_request_uid);
      if (!pageRequestUid) return null;
      return {
        paymentId: str(transaction.more_info),
        fields: { pageRequestUid },
        // Signed by PayPlus: its outcome is authentic (amount still checked against our payment).
        signedStatus: outcomeOf(transaction),
      };
    },

    matches(ref: ProviderRef, n: Notification): boolean {
      return sameSecret(ref.pageRequestUid, n.fields.pageRequestUid);
    },

    async fetchStatus(ref: ProviderRef): Promise<VerifiedStatus> {
      if (!ref.pageRequestUid) return { status: 'pending' };
      let json: Json;
      try {
        json = await call('PaymentPages/ipn', { payment_request_uid: ref.pageRequestUid });
      } catch (err) {
        // "No such transaction yet" and similar answers are not a payment.
        if (err instanceof ProviderError && !err.retryable) return { status: 'pending' };
        throw err;
      }
      // Undocumented layout: look for a transaction record of *this* payment page request.
      const d = json.data;
      const candidates: unknown[] = [d, isObj(d) ? d.transaction : undefined, ...(Array.isArray(d) ? d : []), ...(isObj(d) && Array.isArray(d.transactions) ? d.transactions : [])];
      const approved = candidates.find(
        (c): c is Json =>
          isObj(c) && str(c.status_code) === APPROVED &&
          (str(c.payment_request_uid) === undefined || str(c.payment_request_uid) === ref.pageRequestUid),
      );
      return approved ? outcomeOf(approved) : { status: 'pending' };
    },
  };
}
