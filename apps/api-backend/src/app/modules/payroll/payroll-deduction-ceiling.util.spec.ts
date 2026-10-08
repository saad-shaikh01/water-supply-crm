import { applyDeductionCeiling } from './payroll-deduction-ceiling.util';

describe('applyDeductionCeiling()', () => {
  const base = { baseSalary: 50000, deferredIn: 0 };

  it('ceiling OFF (null / undefined / 0): charges every deduction in full and defers nothing', () => {
    for (const maxDeductionPercent of [null, undefined, 0]) {
      expect(applyDeductionCeiling({ ...base, deductionNet: -80000, maxDeductionPercent })).toEqual({
        allowedDeduction: 80000,
        deferredOut: 0,
        netCredit: 0,
      });
    }
  });

  it('within the ceiling: charged in full, nothing deferred', () => {
    expect(applyDeductionCeiling({ ...base, deductionNet: -20000, maxDeductionPercent: 50 })).toEqual({
      allowedDeduction: 20000,
      deferredOut: 0,
      netCredit: 0,
    });
  });

  it('exactly at the ceiling: charged in full, nothing deferred', () => {
    expect(applyDeductionCeiling({ ...base, deductionNet: -25000, maxDeductionPercent: 50 })).toEqual({
      allowedDeduction: 25000,
      deferredOut: 0,
      netCredit: 0,
    });
  });

  it('the exact scenario from the owner: 50,000 salary, 80,000 of deductions, 50% ceiling => 25,000 charged, 55,000 deferred', () => {
    expect(applyDeductionCeiling({ ...base, deductionNet: -80000, maxDeductionPercent: 50 })).toEqual({
      allowedDeduction: 25000,
      deferredOut: 55000,
      netCredit: 0,
    });
  });

  it('100% ceiling caps at the base salary (never lets a period go negative from deductions alone)', () => {
    expect(applyDeductionCeiling({ ...base, deductionNet: -80000, maxDeductionPercent: 100 })).toEqual({
      allowedDeduction: 50000,
      deferredOut: 30000,
      netCredit: 0,
    });
  });

  it("last period's deferredOut is owed on top and goes through the same ceiling", () => {
    expect(applyDeductionCeiling({ ...base, deductionNet: -10000, deferredIn: 30000, maxDeductionPercent: 50 })).toEqual({
      allowedDeduction: 25000,
      deferredOut: 15000,
      netCredit: 0,
    });
  });

  it('a deferred backlog with NO new deductions still drains (deductionNet = 0)', () => {
    expect(applyDeductionCeiling({ ...base, deductionNet: 0, deferredIn: 40000, maxDeductionPercent: 50 })).toEqual({
      allowedDeduction: 25000,
      deferredOut: 15000,
      netCredit: 0,
    });
  });

  it('turning the ceiling off collects the whole backlog at once instead of stranding it', () => {
    expect(applyDeductionCeiling({ ...base, deductionNet: -10000, deferredIn: 30000, maxDeductionPercent: null })).toEqual({
      allowedDeduction: 40000,
      deferredOut: 0,
      netCredit: 0,
    });
  });

  it('a net CREDIT in the deduction buckets (e.g. a correction) is paid out and never capped or deferred', () => {
    expect(applyDeductionCeiling({ ...base, deductionNet: 1500, maxDeductionPercent: 10 })).toEqual({
      allowedDeduction: 0,
      deferredOut: 0,
      netCredit: 1500,
    });
  });

  it('invariant: allowed + deferredOut always equals everything owed (nothing is created or lost)', () => {
    for (const pct of [null, 1, 10, 33, 50, 99, 100]) {
      for (const net of [-100000, -49999, -1, 0, 777]) {
        for (const deferredIn of [0, 1, 12345]) {
          const r = applyDeductionCeiling({ baseSalary: 37777, deductionNet: net, deferredIn, maxDeductionPercent: pct });
          expect(r.allowedDeduction + r.deferredOut).toBe(Math.max(0, -net) + deferredIn);
          expect(r.allowedDeduction).toBeGreaterThanOrEqual(0);
          expect(r.deferredOut).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('a zero base salary with a ceiling defers everything (ceiling is a % of nothing)', () => {
    expect(applyDeductionCeiling({ baseSalary: 0, deductionNet: -500, deferredIn: 0, maxDeductionPercent: 50 })).toEqual({
      allowedDeduction: 0,
      deferredOut: 500,
      netCredit: 0,
    });
  });

  it('rounds the ceiling to a whole rupee', () => {
    // 33% of 1001 = 330.33 -> 330
    expect(applyDeductionCeiling({ baseSalary: 1001, deductionNet: -1000, deferredIn: 0, maxDeductionPercent: 33 })).toEqual({
      allowedDeduction: 330,
      deferredOut: 670,
      netCredit: 0,
    });
  });
});
