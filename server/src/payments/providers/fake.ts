/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ProviderError, type Notification, type PaymentProvider, type ProviderRef, type RefundRequest, type RefundResult, type Session, type SessionRequest, type VerifiedStatus } from './types';

/**
 * Demo provider for development, tests and demos: a page on our own server with "Approve" and
 * "Decline" buttons. It takes no money. The config refuses it in production (PAYMENTS_ALLOW_FAKE).
 * It follows the same trust rules as a real provider: a notification carries a per-payment secret,
 * and the status comes from the stored outcome, not from the browser.
 */
export function fakeProvider(publicBase: string): PaymentProvider {
  const base = publicBase.endsWith('/') ? publicBase : `${publicBase}/`;
  return {
    id: 'fake',
    checkoutOrigins: [],
    requiresPayer: false,
    async createSession(req: SessionRequest): Promise<Session> {
      return {
        redirectUrl: new URL(`pay/demo/${req.paymentId}`, base).toString(),
        ref: {
          demoSecret: randomBytes(16).toString('base64url'),
          amount: String(req.amountAgorot),
          successUrl: req.successUrl,
          cancelUrl: req.cancelUrl,
        },
      };
    },
    parseNotification(body: unknown): Notification | null {
      if (!body || typeof body !== 'object') return null;
      const { paymentId, demoSecret } = body as Record<string, unknown>;
      if (typeof paymentId !== 'string' || typeof demoSecret !== 'string') return null;
      return { paymentId, fields: { demoSecret } };
    },
    matches(ref: ProviderRef, n: Notification): boolean {
      const a = Buffer.from(ref.demoSecret ?? '');
      const b = Buffer.from(n.fields.demoSecret ?? '');
      return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
    },
    async fetchStatus(ref: ProviderRef): Promise<VerifiedStatus> {
      if (ref.outcome === 'paid') return { status: 'paid', amountAgorot: Number(ref.amount), transactionRef: ref.txn };
      if (ref.outcome === 'declined') return { status: 'failed' };
      return { status: 'pending' };
    },
    refundPolicy: { partialSameDay: true },
    refundable(ref: ProviderRef): boolean {
      return ref.outcome === 'paid';
    },
    async refund(ref: ProviderRef, req: RefundRequest): Promise<RefundResult> {
      if (ref.outcome !== 'paid') throw new ProviderError('fake refund: not paid', false);
      return { refundRef: `DEMO-R-${req.refundId.slice(0, 8).toUpperCase()}` };
    },
  };
}
