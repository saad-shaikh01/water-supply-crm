import { BadRequestException } from '@nestjs/common';
import {
  POSTABLE_ADJUSTMENT_KINDS,
  customerFacingAdjustmentText,
  customerFacingReversalText,
  normalizeAdjustmentAmount,
  oppositeAdjustmentDirection,
  resolveAdjustmentDirection,
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

describe('oppositeAdjustmentDirection', () => {
  it('flips CHARGE and CREDIT, and is its own inverse', () => {
    expect(oppositeAdjustmentDirection('CHARGE')).toBe('CREDIT');
    expect(oppositeAdjustmentDirection('CREDIT')).toBe('CHARGE');
    expect(oppositeAdjustmentDirection(oppositeAdjustmentDirection('CHARGE'))).toBe('CHARGE');
  });

  it('a reversal always nets the original to zero on the ledger', () => {
    for (const d of ['CHARGE', 'CREDIT'] as const) {
      const original = signedAdjustmentAmount(d, 123.45);
      const reversal = signedAdjustmentAmount(oppositeAdjustmentDirection(d), 123.45);
      expect(original + reversal).toBe(0);
    }
  });
});

describe('customerFacingReversalText', () => {
  it('ITEMIZED names what was reversed', () => {
    expect(customerFacingReversalText('ITEMIZED', 'Installation charge')).toBe('Reversal: Installation charge');
  });

  it('SUMMARIZED stays neutral — voiding must not un-hide it, and the staff title never leaks', () => {
    const text = customerFacingReversalText('SUMMARIZED', 'INTERNAL: duplicate fix');
    expect(text).toBe('Account adjustment reversal');
    expect(text).not.toContain('INTERNAL');
  });
});

describe('POSTABLE_ADJUSTMENT_KINDS (create endpoint gate)', () => {
  it('is exactly the charge, credit and restricted kinds (2A + 2D)', () => {
    expect([...POSTABLE_ADJUSTMENT_KINDS].sort()).toEqual(
      ['CORRECTION', 'DISCOUNT', 'GOODWILL_CREDIT', 'OTHER_CHARGE', 'OTHER_CREDIT', 'PENALTY', 'SERVICE_FEE', 'WRITE_OFF'],
    );
  });

  it('every postable kind is standalone, has a resolvable direction, a visibility and a posting permission', () => {
    for (const k of POSTABLE_ADJUSTMENT_KINDS) {
      const p = ADJUSTMENT_KIND_POLICY[k];
      expect(STANDALONE_ADJUSTMENT_KINDS).toContain(k);
      expect(['CHARGE', 'CREDIT', 'EITHER']).toContain(p.direction); // never DERIVED
      expect(['ITEMIZED', 'SUMMARIZED']).toContain(p.visibility); // never DERIVED
      expect(['create', 'create_credit', 'create_restricted']).toContain(p.permission);
    }
  });

  it('CORRECTION is the ONLY postable kind whose direction the caller chooses', () => {
    const chosen = POSTABLE_ADJUSTMENT_KINDS.filter((k) => ADJUSTMENT_KIND_POLICY[k].direction === 'EITHER');
    expect(chosen).toEqual(['CORRECTION']);
  });

  it('excludes the transfer legs and REVERSAL — they have their own paths', () => {
    for (const k of ['TRANSFER_OUT', 'TRANSFER_IN', 'REVERSAL']) {
      expect((POSTABLE_ADJUSTMENT_KINDS as readonly string[]).includes(k)).toBe(false);
    }
  });
});

describe('resolveAdjustmentDirection', () => {
  it('fixed kinds: the policy direction wins when nothing is sent', () => {
    expect(resolveAdjustmentDirection('CHARGE')).toBe('CHARGE');
    expect(resolveAdjustmentDirection('CREDIT')).toBe('CREDIT');
  });

  it('fixed kinds: sending the SAME direction is accepted', () => {
    expect(resolveAdjustmentDirection('CHARGE', 'CHARGE')).toBe('CHARGE');
    expect(resolveAdjustmentDirection('CREDIT', 'CREDIT')).toBe('CREDIT');
  });

  it('fixed kinds: a CONFLICTING direction is a 400 — never silently ignored', () => {
    expect(() => resolveAdjustmentDirection('CHARGE', 'CREDIT')).toThrow(BadRequestException);
    expect(() => resolveAdjustmentDirection('CHARGE', 'CREDIT')).toThrow(/fixed \(CHARGE\)/);
    expect(() => resolveAdjustmentDirection('CREDIT', 'CHARGE')).toThrow(/fixed \(CREDIT\)/);
  });

  it('EITHER (CORRECTION): the caller must choose; there is no default', () => {
    expect(resolveAdjustmentDirection('EITHER', 'CHARGE')).toBe('CHARGE');
    expect(resolveAdjustmentDirection('EITHER', 'CREDIT')).toBe('CREDIT');
    expect(() => resolveAdjustmentDirection('EITHER')).toThrow(/must say whether/);
    expect(() => resolveAdjustmentDirection('EITHER', 'SIDEWAYS' as any)).toThrow(BadRequestException);
  });

  it('DERIVED (REVERSAL) can never be posted directly', () => {
    expect(() => resolveAdjustmentDirection('DERIVED')).toThrow(BadRequestException);
    expect(() => resolveAdjustmentDirection('DERIVED', 'CHARGE')).toThrow(BadRequestException);
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

  it('backdates an earlier day of the current month to that day\'s vendor NOON', () => {
    // PKT noon of Sept 5 = Sept 5 07:00 UTC
    expect(resolveAdjustmentEffectiveDate('2026-09-05', NOW)).toEqual(new Date('2026-09-05T07:00:00.000Z'));
  });

  it('a backdated entry sits on the SAME calendar day under BOTH the vendor (PKT) and a UTC reading', () => {
    // Statement windows are cut at the server's local midnight (UTC in production), so an
    // entry must not straddle a day boundary in either timezone. (PKT midnight would have
    // been the previous UTC day.)
    const d = resolveAdjustmentEffectiveDate('2026-09-05', NOW);
    expect(d.toISOString().slice(0, 10)).toBe('2026-09-05'); // UTC day
    expect(d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })).toBe('2026-09-05'); // PKT day
  });

  it('allows the first day of the month (boundary)', () => {
    expect(resolveAdjustmentEffectiveDate('2026-09-01', NOW)).toEqual(new Date('2026-09-01T07:00:00.000Z'));
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
