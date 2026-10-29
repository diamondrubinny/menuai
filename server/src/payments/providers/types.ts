/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * One adapter per payment provider. Every provider uses its own hosted payment page, so card details
 * go from the guest straight to the provider and never pass through MenuAI.
 *
 * Trust rule: a browser redirect or a provider notification is only a *hint*. A payment becomes
 * "paid" only after `fetchStatus` confirms it server-to-server, for the exact amount we asked for.
 */
export const PROVIDER_IDS = ['fake', 'grow', 'payplus'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type PaymentMode = 'test' | 'live';

/** The provider's own identifiers for one payment, stored as-is (never card data). */
export type ProviderRef = Record<string, string>;

export interface Payer {
  fullName: string;
  phone: string;
}

export interface SessionRequest {
  paymentId: string;
  amountAgorot: number;
  /** Plain description, no special characters (some providers reject them). */
  description: string;
  payer: Payer;
  successUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  locale: string;
}

export interface Session {
  redirectUrl: string;
  ref: ProviderRef;
}

export interface VerifiedStatus {
  status: 'paid' | 'failed' | 'pending';
  /** What the provider says was charged; must equal what we asked for. */
  amountAgorot?: number;
  /** The provider's transaction reference (shown to staff for reconciliation). */
  transactionRef?: string;
  /** The provider's handles needed to refund this charge later (stored with the payment; never card data). */
  refundRef?: ProviderRef;
}

export interface Notification {
  /** Our payment id, if the provider echoes it back. Untrusted. */
  paymentId?: string;
  /** Raw fields to echo back in an acknowledgement (Grow approveTransaction). Untrusted. */
  fields: Record<string, string>;
  /**
   * Set only by providers that cryptographically sign their notifications (e.g. PayPlus HMAC), after
   * the signature checked out: the outcome then needs no extra status call. It is still matched to
   * the stored payment and must carry the exact amount.
   */
  signedStatus?: VerifiedStatus;
  /** Refund handles carried by a notification that matched the stored payment (see VerifiedStatus.refundRef). */
  refundRef?: ProviderRef;
}

/** The raw request, for providers that sign their notifications. */
export interface NotificationContext {
  rawBody?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface RefundRequest {
  amountAgorot: number;
  /** Our refund id (for the provider's logs where it takes one). */
  refundId: string;
}

export interface RefundResult {
  /** The provider's reference for the refund, when it returns one. */
  refundRef?: string;
}

/** Provider limits checked before a refund is attempted. */
export interface RefundPolicy {
  /** Most refunds the provider allows per charge through its API. */
  maxRefunds?: number;
  /** Whether a partial refund is possible on the business day of the charge (Grow: no, it is a cancellation). */
  partialSameDay: boolean;
}

export interface PaymentProvider {
  readonly id: ProviderId;
  /** Origins of the hosted payment page, for the pay page's CSP `form-action` (empty = our own origin). */
  readonly checkoutOrigins: string[];
  /** Whether the provider requires the payer's full name and mobile phone (passed through, never stored). */
  readonly requiresPayer: boolean;
  createSession(req: SessionRequest): Promise<Session>;
  /** Reads a server-to-server notification. Returns null when it is not one of ours. */
  parseNotification(body: unknown, ctx?: NotificationContext): Notification | null;
  /** True when this notification belongs to the stored payment (e.g. its process token matches). */
  matches(ref: ProviderRef, notification: Notification): boolean;
  fetchStatus(ref: ProviderRef): Promise<VerifiedStatus>;
  /** Tells the provider the notification was handled, when it requires that (after a verified payment). */
  acknowledge?(ref: ProviderRef, notification: Notification): Promise<void>;
  /** Refund limits, present when the provider supports refunds through its API. */
  readonly refundPolicy?: RefundPolicy;
  /**
   * Refunds part or all of a confirmed charge. Resolves only when the provider accepted the refund.
   * Throws ProviderError(retryable = false) when the provider refused it, and a retryable one when
   * the outcome is unknown (network error, timeout, 5xx): the refund may have happened, so it must
   * never be retried automatically.
   */
  refund?(ref: ProviderRef, req: RefundRequest): Promise<RefundResult>;
  /** Whether the stored identifiers include what `refund` needs (checked before anything is recorded). */
  refundable?(ref: ProviderRef): boolean;
}

export class ProviderError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message);
  }
}
