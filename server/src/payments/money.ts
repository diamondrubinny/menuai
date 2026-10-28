/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
/**
 * Money math for paying a bill. Everything is integer agorot (1/100 ₪): never floats.
 * The guest only *chooses* (whole bill / equal split / an amount, and a tip); the server computes.
 */
import { z } from 'zod';

/** Smallest charge (₪1). Card fees make smaller charges pointless, and it blocks card-testing with tiny sums. */
export const MIN_CHARGE_AGOROT = 100;
export const MAX_SPLIT_PARTS = 20;
/** A tip may not exceed the share it is added to (catches typos like 1500 instead of 15). */
export const MAX_TIP_RATIO = 1;

export const shareChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('full') }),
  z.object({ kind: z.literal('split'), parts: z.coerce.number().int().min(2).max(MAX_SPLIT_PARTS) }),
  z.object({ kind: z.literal('custom'), agorot: z.coerce.number().int().min(1).max(10_000_000) }),
]);
export type ShareChoice = z.infer<typeof shareChoiceSchema>;

export const tipChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('percent'), percent: z.coerce.number().int().min(1).max(100) }),
  z.object({ kind: z.literal('custom'), agorot: z.coerce.number().int().min(1).max(10_000_000) }),
]);
export type TipChoice = z.infer<typeof tipChoiceSchema>;

export interface BillTotals {
  /** The bill amount the waiter entered. */
  amount: number;
  /** Shares already paid (tips excluded). */
  paid: number;
  /** Shares of checkouts still in progress (reserved, so two guests can't both pay the whole bill). */
  pending: number;
}

/** What is still open for new checkouts. Never negative (an overpayment is the staff's to refund). */
export function remainingAgorot(t: BillTotals): number {
  return Math.max(0, t.amount - t.paid - t.pending);
}

export type ChargeError = 'nothing_to_pay' | 'invalid_share' | 'invalid_tip';

export interface Charge {
  share: number;
  tip: number;
  total: number;
}

/**
 * Turns the guest's choice into exact amounts, against what is still open.
 * - full: everything that remains.
 * - split: the bill divided equally (rounded up to the agora), capped at what remains, so the last
 *   diner never pays more than is left.
 * - custom: any amount between ₪1 and what remains (or exactly what remains when that is under ₪1).
 */
export function computeCharge(
  totals: BillTotals,
  share: ShareChoice,
  tip: TipChoice,
  allowedTipPercents: readonly number[],
): Charge | ChargeError {
  const remaining = remainingAgorot(totals);
  if (remaining <= 0) return 'nothing_to_pay';

  let shareAgorot: number;
  switch (share.kind) {
    case 'full':
      shareAgorot = remaining;
      break;
    case 'split':
      shareAgorot = Math.min(remaining, Math.ceil(totals.amount / share.parts));
      break;
    case 'custom': {
      const min = Math.min(MIN_CHARGE_AGOROT, remaining);
      if (share.agorot < min || share.agorot > remaining) return 'invalid_share';
      shareAgorot = share.agorot;
      break;
    }
  }

  let tipAgorot = 0;
  if (tip.kind === 'percent') {
    if (!allowedTipPercents.includes(tip.percent)) return 'invalid_tip';
    tipAgorot = Math.round((shareAgorot * tip.percent) / 100);
  } else if (tip.kind === 'custom') {
    if (tip.agorot > shareAgorot * MAX_TIP_RATIO) return 'invalid_tip';
    tipAgorot = tip.agorot;
  }

  const total = shareAgorot + tipAgorot;
  // A share below ₪1 is allowed only when it closes the bill; the charge itself must still be ≥ ₪1.
  if (total < MIN_CHARGE_AGOROT && shareAgorot !== remaining) return 'invalid_share';
  return { share: shareAgorot, tip: tipAgorot, total };
}

/** "12345" agorot → "123.45" (the decimal string payment providers expect). */
export function agorotToDecimal(agorot: number): string {
  if (!Number.isSafeInteger(agorot) || agorot < 0) throw new RangeError('agorot must be a non-negative integer');
  return `${Math.floor(agorot / 100)}.${String(agorot % 100).padStart(2, '0')}`;
}

/** "123.45" / "123.4" / "123" / 123.45 → 12345, or null when it is not an exact amount of agorot. */
export function decimalToAgorot(value: unknown): number | null {
  const s = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** Display: "₪1,234.50" style, in the guest's locale. */
export function formatShekels(agorot: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'ILS', minimumFractionDigits: agorot % 100 ? 2 : 0 }).format(agorot / 100);
}
