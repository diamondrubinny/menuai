/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { describe, expect, it } from 'vitest';
import { refundableAgorot, shekelsToAgorot, type Refund } from '../src/api/payments';

const r = (amountAgorot: number, status: Refund['status']): Refund => ({
  id: crypto.randomUUID(), amountAgorot, status, needsConfirmation: status === 'unknown', refundRef: null, note: '', createdAt: '', completedAt: null,
});

describe('staff payment helpers', () => {
  it('parses shekel amounts into agorot', () => {
    expect(shekelsToAgorot('184')).toBe(18400);
    expect(shekelsToAgorot(' 12,5 ')).toBe(1250);
    expect(shekelsToAgorot('0.05')).toBe(5);
    for (const bad of ['', '1.234', '-3', '1e3', '12.', 'abc']) expect(shekelsToAgorot(bad)).toBeNull();
  });

  it('counts what can still be refunded: share + tip minus refunds that went through or may have', () => {
    const p = { shareAgorot: 10000, tipAgorot: 1000, refunds: [] as Refund[] };
    expect(refundableAgorot(p)).toBe(11000);
    expect(refundableAgorot({ ...p, refunds: [r(3000, 'succeeded'), r(500, 'failed')] })).toBe(8000);
    // An unknown refund may have happened: never offer that money twice.
    expect(refundableAgorot({ ...p, refunds: [r(3000, 'succeeded'), r(8000, 'unknown')] })).toBe(0);
  });
});
