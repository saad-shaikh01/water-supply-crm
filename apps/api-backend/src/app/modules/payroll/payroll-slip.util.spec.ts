import { applyDeductionCeiling } from './payroll-deduction-ceiling.util';
import {
  buildSalarySlip,
  buildSlipLines,
  classifySlipEntry,
  formatRupees,
  slipFilename,
  sumSlipLines,
  summarizeSlipAbsence,
  type SlipAttendanceInput,
  type SlipEntryInput,
} from './payroll-slip.util';

const entryOf = (over: Partial<SlipEntryInput> = {}): SlipEntryInput => ({
  baseSalary: 30000,
  bonuses: 0,
  overtime: 0,
  incentives: 0,
  advances: 0,
  expenses: 0,
  penalties: 0,
  otherDeductions: 0,
  carryForwardIn: 0,
  deferredIn: 0,
  deferredOut: 0,
  finalPayable: 30000,
  status: 'APPROVED',
  ...over,
});

const attendanceOf = (over: Partial<SlipAttendanceInput> = {}): SlipAttendanceInput => ({
  decisionsApply: true,
  periodDayCount: 30,
  presentDays: 26,
  absentDays: 0,
  halfDays: 0,
  leaveDays: 0,
  days: [],
  ...over,
});

/** The engine's own formula (computeEntryBreakdown) so the slip is checked against the real payable math. */
function enginePayable(base: number, b: Pick<SlipEntryInput, 'bonuses' | 'overtime' | 'incentives' | 'expenses' | 'advances' | 'penalties' | 'otherDeductions'>, carry: number, deferredIn: number, pct: number | null) {
  const { allowedDeduction, deferredOut, netCredit } = applyDeductionCeiling({
    baseSalary: base,
    deductionNet: b.advances + b.penalties + b.otherDeductions,
    deferredIn,
    maxDeductionPercent: pct,
  });
  const finalPayable = base + b.bonuses + b.overtime + b.incentives + b.expenses + netCredit + carry - allowedDeduction;
  return { finalPayable, deferredOut };
}

describe('classifySlipEntry', () => {
  it.each(['APPROVED', 'LOCKED', 'SETTLED'])('%s with a phone is ELIGIBLE', (status) => {
    expect(classifySlipEntry({ status }, '0300-1234567')).toBe('ELIGIBLE');
  });

  it.each(['DRAFT', 'UNDER_REVIEW'])('%s is NOT_FINAL even with a phone', (status) => {
    expect(classifySlipEntry({ status }, '03001234567')).toBe('NOT_FINAL');
  });

  it('NOT_FINAL wins over NO_PHONE', () => {
    expect(classifySlipEntry({ status: 'DRAFT' }, null)).toBe('NOT_FINAL');
  });

  it.each([null, undefined, '', '-', 'n/a', '123'])('a final entry with phone %p is NO_PHONE', (phone) => {
    expect(classifySlipEntry({ status: 'APPROVED' }, phone as any)).toBe('NO_PHONE');
  });
});

describe('buildSlipLines — reconciles to the engine finalPayable', () => {
  const buckets = { bonuses: 2000, overtime: 1500, incentives: 500, expenses: 800, advances: -5000, penalties: -1000, otherDeductions: -2500 };

  it.each([
    ['ceiling off, no carry', null, 0, 0],
    ['ceiling off, carry-forward', null, 4000, 0],
    ['ceiling off, deferredIn charged now', null, 0, 3000],
    ['ceiling 10% holds back deduction', 10, 0, 0],
    ['ceiling 10% with deferredIn and carry', 10, 2500, 6000],
    ['ceiling 100% (never binds)', 100, 0, 0],
  ])('%s', (_name, pct, carry, deferredIn) => {
    const { finalPayable, deferredOut } = enginePayable(30000, buckets, carry, deferredIn, pct);
    const lines = buildSlipLines(entryOf({ ...buckets, carryForwardIn: carry, deferredIn, deferredOut, finalPayable }));
    expect(sumSlipLines(lines)).toBe(finalPayable);
  });

  it('a net CREDIT in the deduction buckets still reconciles', () => {
    const credit = { ...buckets, advances: 0, penalties: 0, otherDeductions: 1200 };
    const { finalPayable, deferredOut } = enginePayable(30000, credit, 0, 0, 10);
    const lines = buildSlipLines(entryOf({ ...credit, deferredOut, finalPayable }));
    expect(sumSlipLines(lines)).toBe(finalPayable);
  });

  it('omits zero lines but always keeps the base salary', () => {
    expect(buildSlipLines(entryOf())).toEqual([{ label: 'Base salary', amount: 30000 }]);
  });

  it('shows deferredIn as a deduction and deferredOut as a (not-deducted) add-back', () => {
    const lines = buildSlipLines(entryOf({ deferredIn: 3000, deferredOut: 1000 }));
    expect(lines.find((l) => l.label.startsWith('Held-back deductions from previous'))?.amount).toBe(-3000);
    expect(lines.find((l) => l.label.startsWith('Deductions held back to next'))?.amount).toBe(1000);
  });
});

describe('summarizeSlipAbsence', () => {
  const day = (decision: any, extra: any = {}) => ({ date: new Date('2026-09-02T00:00:00Z'), status: 'ABSENT', decision, ...extra });

  it('splits deducted-now, deducted-next-month, waived and pending days', () => {
    const out = summarizeSlipAbsence(
      attendanceOf({
        absentDays: 5,
        halfDays: 1,
        days: [
          day('DEDUCTED', { deductedAmount: 1000 }),
          day('DEDUCTED', { deductedAmount: 500 }),
          day('DEDUCTED', { deductedAmount: 1000, deductionDeferred: true }),
          day('WAIVED'),
          day('PENDING'),
          day(null),
        ],
      }),
    );
    expect(out).toMatchObject({
      absentDays: 5,
      halfDays: 1,
      deductedDays: 2,
      deductedAmount: 1500,
      deferredDays: 1,
      deferredAmount: 1000,
      waivedDays: 1,
      pendingDays: 1,
    });
  });
});

describe('buildSalarySlip', () => {
  it('carries only the employee own figures + period + attendance', () => {
    const slip = buildSalarySlip({
      vendorName: 'Blue Ice',
      employee: { name: 'Ali Raza', role: 'LOADER' },
      period: { periodLabel: '2026-09', startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-30T23:59:59.999Z') },
      entry: entryOf({ bonuses: 1000, finalPayable: 31000 }),
      attendance: attendanceOf({ presentDays: 28, absentDays: 2 }),
    });
    expect(slip).toMatchObject({
      vendorName: 'Blue Ice',
      employeeName: 'Ali Raza',
      periodLabel: '2026-09',
      finalPayable: 31000,
      attendance: { presentDays: 28, absentDays: 2, periodDayCount: 30 },
    });
    expect(sumSlipLines(slip.lines)).toBe(31000);
  });
});

describe('formatting', () => {
  it('formatRupees groups thousands, no currency symbol', () => {
    expect(formatRupees(45000)).toBe('45,000');
    expect(formatRupees(-1250.4)).toBe('-1,250');
  });

  it('slipFilename is filesystem-safe', () => {
    expect(slipFilename('Ali Raza', '2026-09')).toBe('Salary-Slip-2026-09-Ali-Raza.pdf');
    expect(slipFilename('../../etc/passwd', '2026-09')).toBe('Salary-Slip-2026-09-etc-passwd.pdf');
    expect(slipFilename('', '2026-09')).toBe('Salary-Slip-2026-09-Employee.pdf');
  });
});
