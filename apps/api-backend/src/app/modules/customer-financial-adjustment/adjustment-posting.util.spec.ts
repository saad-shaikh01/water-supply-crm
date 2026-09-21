import { BadRequestException } from '@nestjs/common';
import {
  POSTABLE_ADJUSTMENT_KINDS,
  customerFacingAdjustmentText,
  normalizeAdjustmentAmount,
  resolveAdjustmentEffectiveDate,
  signedAdjustmentAmount,
} from './adjustment-posting.util';
import { ADJUSTMENT_KIND_POLICY, STANDALONE_ADJUSTMENT_KINDS } from '@water-supply-crm/types';

describe('normalizeAdjustmentAmount', () => {
  it.each([
    [1000, 1000],
    [0.01, 0.01],
    [1234.56, 1234.56],
    [19.99, 19.99],
    [100.1, 100.1],
    // Classic binary-float artefact: 1.1 * 100 === 110.00000000000001 — must NOT be
    // rejected as "more than 2 decimal places".
    [1.1, 1.1],
    [0.07, 0.07],
    [2350, 2350],
  ])('accepts %p', (input, expected) => {
    expect(normalizeAdjustmentAmount(input)).toBe(expected);
  });

  it.each([
    [0, /greater than 0/],
    [-5, /greater than 0/],
    [NaN, /valid number/],
    [Infinity, /valid number/],
    [1000.005, /2 decimal places/],
    [0.001, /2 decimal places/],
    [12.345, /2 decimal places/],
    ['500' as unknown as number, /valid number/],
    [null as unknown as number, /valid number/],
    [undefined as unknown as number, /valid number/],
  ])('rejects %p', (input, message) => {
    expect(() => normalizeAdjustmentAmount(input)).toThrow(BadRequestException);
    expect(() => normalizeAdjustmentAmount(input)).toThrow(message);
  });
});

describe('signedAdjustmentAmount', () => {
  it('CHARGE increases what the customer owes (+), CREDIT reduces it (−)', () => {
    expect(signedAdjustmentAmount('CHARGE', 500)).toBe(500);
    expect(signedAdjustmentAmount('CREDIT', 500)).toBe(-500);
  });
});

describe('customerFacingAdjustmentText', () => {
  it('ITEMIZED shows the title; SUMMARIZED shows only the neutral label (staff title never leaks)', () => {
    expect(customerFacingAdjustmentText('ITEMIZED', 'Late payment penalty')).toBe('Late payment penalty');
    expect(customerFacingAdjustmentText('SUMMARIZED', 'Duplicate charge fix (internal)')).toBe('Account adjustment');
  });
});

describe('POSTABLE_ADJUSTMENT_KINDS (Phase 2A slice gate)', () => {
  it('is exactly the six charge/credit kinds', () => {
    expect([...POSTABLE_ADJUSTMENT_KINDS].sort()).toEqual(
      ['DISCOUNT', 'GOODWILL_CREDIT', 'OTHER_CHARGE', 'OTHER_CREDIT', 'PENALTY', 'SERVICE_FEE'],
    );
  });

  it('every postable kind is standalone with a FIXED direction/visibility and a permission', () => {
    for (const k of POSTABLE_ADJUSTMENT_KINDS) {
      const p = ADJUSTMENT_KIND_POLICY[k];
      expect(STANDALONE_ADJUSTMENT_KINDS).toContain(k);
      expect(['CHARGE', 'CREDIT']).toContain(p.direction);
      expect(['ITEMIZED', 'SUMMARIZED']).toContain(p.visibility);
      expect(['create', 'create_credit']).toContain(p.permission);
    }
  });

  it('excludes write-off / correction / transfer legs / reversal until their slice ships', () => {
    for (const k of ['WRITE_OFF', 'CORRECTION', 'TRANSFER_OUT', 'TRANSFER_IN', 'REVERSAL']) {
      expect((POSTABLE_ADJUSTMENT_KINDS as readonly string[]).includes(k)).toBe(false);
    }
  });
});

describe('resolveAdjustmentEffectiveDate', () => {
  // 2026-09-20 09:00 UTC = 14:00 PKT, mid-month.
  const NOW = new Date('2026-09-20T09:00:00.000Z');

  it('posts "now" when the date is omitted, empty, or today (vendor timezone)', () => {
    expect(resolveAdjustmentEffectiveDate(undefined, NOW)).toBe(NOW);
    expect(resolveAdjustmentEffectiveDate('', NOW)).toBe(NOW);
    expect(resolveAdjustmentEffectiveDate('2026-09-20', NOW)).toBe(NOW);
    expect(resolveAdjustmentEffectiveDate('2026-09-20T03:00:00.000Z', NOW)).toBe(NOW);
  });

  it('backdates an earlier day of the current month to that day\'s PKT midnight', () => {
    // PKT midnight of Sept 5 = Sept 4 19:00 UTC
    expect(resolveAdjustmentEffectiveDate('2026-09-05', NOW)).toEqual(new Date('2026-09-04T19:00:00.000Z'));
  });

  it('allows the first day of the month (boundary)', () => {
    expect(resolveAdjustmentEffectiveDate('2026-09-01', NOW)).toEqual(new Date('2026-08-31T19:00:00.000Z'));
  });

  it('rejects a date in a previous month', () => {
    expect(() => resolveAdjustmentEffectiveDate('2026-08-31', NOW)).toThrow(/current month/);
  });

  it('rejects a future date', () => {
    expect(() => resolveAdjustmentEffectiveDate('2026-09-21', NOW)).toThrow(/future/);
    expect(() => resolveAdjustmentEffectiveDate('2027-01-01', NOW)).toThrow(/future/);
  });

  it('rejects garbage', () => {
    expect(() => resolveAdjustmentEffectiveDate('not-a-date', NOW)).toThrow(BadRequestException);
  });

  describe('vendor timezone, not the server\'s (production runs UTC)', () => {
    it('00:00-05:00 PKT: server UTC day is still "yesterday" but the vendor\'s today is accepted', () => {
      // 2026-09-20 20:00 UTC = 2026-09-21 01:00 PKT
      const late = new Date('2026-09-20T20:00:00.000Z');
      expect(resolveAdjustmentEffectiveDate('2026-09-21', late)).toBe(late);
      expect(() => resolveAdjustmentEffectiveDate('2026-09-22', late)).toThrow(/future/);
    });

    it('month rollover: at 01:00 PKT on Sept 1 (UTC still Aug 31), Aug 31 is the PREVIOUS month', () => {
      const rollover = new Date('2026-08-31T20:00:00.000Z'); // Sept 1 01:00 PKT
      expect(resolveAdjustmentEffectiveDate('2026-09-01', rollover)).toBe(rollover);
      expect(() => resolveAdjustmentEffectiveDate('2026-08-31', rollover)).toThrow(/current month/);
    });
  });
});
