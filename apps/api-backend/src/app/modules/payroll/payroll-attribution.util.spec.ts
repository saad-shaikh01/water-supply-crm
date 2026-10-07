import { StaffLedgerCategory } from '@prisma/client';
import { attributedWithin, buildLedgerWindowFilter, computeDeferralTarget } from './payroll-attribution.util';
import { computeCycleForCutoff } from './payroll-cycle.util';

const range = { gte: new Date('2026-09-01T00:00:00.000Z'), lte: new Date('2026-09-30T23:59:59.999Z') };

describe('attributedWithin()', () => {
  it('claims an undeferred row by effectiveDate, and a deferred row ONLY by its attribution date', () => {
    expect(attributedWithin(range)).toEqual({
      OR: [{ payrollAttributionDate: null, effectiveDate: range }, { payrollAttributionDate: range }],
    });
  });
});

describe('buildLedgerWindowFilter()', () => {
  const period = { startDate: range.gte, endDate: range.lte };

  it('no cash window: just the attribution-aware period window', () => {
    expect(buildLedgerWindowFilter(period, null)).toEqual(attributedWithin(range));
  });

  it('cash window: category-split, each side attribution-aware', () => {
    const cash = {
      startDate: new Date('2026-09-10T00:00:00.000Z'),
      endDate: new Date('2026-10-09T23:59:59.999Z'),
      categories: [StaffLedgerCategory.ADVANCE],
    };
    expect(buildLedgerWindowFilter(period, cash)).toEqual({
      OR: [
        {
          AND: [
            { category: { in: [StaffLedgerCategory.ADVANCE] } },
            attributedWithin({ gte: cash.startDate, lte: cash.endDate }),
          ],
        },
        { AND: [{ category: { notIn: [StaffLedgerCategory.ADVANCE] } }, attributedWithin(range)] },
      ],
    });
  });
});

describe('computeDeferralTarget()', () => {
  const sep = { periodEnd: new Date('2026-09-30T23:59:59.999Z'), cutoffDay: 1, cashCutoffDay: null, cashWindowCategories: [] };

  it('plain calendar months: the day after the period ends', () => {
    expect(computeDeferralTarget({ ...sep, category: StaffLedgerCategory.PENALTY })).toEqual(
      new Date('2026-10-01T00:00:00.000Z'),
    );
  });

  it('rolls over a year end', () => {
    expect(
      computeDeferralTarget({ ...sep, periodEnd: new Date('2026-12-31T23:59:59.999Z'), category: StaffLedgerCategory.PENALTY }),
    ).toEqual(new Date('2027-01-01T00:00:00.000Z'));
  });

  it('the target lies inside the NEXT period window and outside the current one', () => {
    const target = computeDeferralTarget({ ...sep, category: StaffLedgerCategory.PENALTY });
    const next = computeCycleForCutoff(1, target);
    expect(target >= next.startDate && target <= next.endDate).toBe(true);
    expect(next.periodLabel).toBe('2026-10');
    expect(target > sep.periodEnd).toBe(true);
  });

  describe('category redirected to the separate cash-deduction window (cash cutoff 10th, attendance = calendar month)', () => {
    const cashOpts = { ...sep, cashCutoffDay: 10, cashWindowCategories: [StaffLedgerCategory.ADVANCE] };

    it('a non-redirected category still just moves to the next attendance period', () => {
      expect(computeDeferralTarget({ ...cashOpts, category: StaffLedgerCategory.PENALTY })).toEqual(
        new Date('2026-10-01T00:00:00.000Z'),
      );
    });

    it('a redirected category moves to the start of the NEXT cash cycle - Oct 1 would still be in September\'s own Sep-10..Oct-9 cash cycle', () => {
      const target = computeDeferralTarget({ ...cashOpts, category: StaffLedgerCategory.ADVANCE });
      expect(target).toEqual(new Date('2026-10-10T00:00:00.000Z'));

      // Prove it: September's period claims its cash window = cycle containing Sep 30 = Sep 10..Oct 9.
      const septemberCash = computeCycleForCutoff(10, sep.periodEnd);
      expect(target > septemberCash.endDate).toBe(true);

      // ...and October's period (ends Oct 31) claims the cycle containing Oct 31 = Oct 10..Nov 9, which includes the target.
      const octoberCash = computeCycleForCutoff(10, new Date('2026-10-31T23:59:59.999Z'));
      expect(target >= octoberCash.startDate && target <= octoberCash.endDate).toBe(true);
    });
  });
});
