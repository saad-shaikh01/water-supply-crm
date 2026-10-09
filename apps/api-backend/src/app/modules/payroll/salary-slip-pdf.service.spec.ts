import { SalarySlipPdfService } from './salary-slip-pdf.service';
import { buildSalarySlip, type SlipAttendanceInput } from './payroll-slip.util';

const attendance: SlipAttendanceInput = {
  decisionsApply: true,
  periodDayCount: 30,
  presentDays: 27,
  absentDays: 2,
  halfDays: 1,
  leaveDays: 0,
  days: [
    { date: new Date('2026-09-02T00:00:00Z'), status: 'ABSENT', decision: 'DEDUCTED', deductedAmount: 1000 },
    { date: new Date('2026-09-03T00:00:00Z'), status: 'ABSENT', decision: 'WAIVED' },
    { date: new Date('2026-09-04T00:00:00Z'), status: 'HALF_DAY', decision: 'PENDING' },
  ],
};

describe('SalarySlipPdfService', () => {
  const svc = new SalarySlipPdfService();
  const slip = buildSalarySlip({
    vendorName: 'Blue Ice',
    employee: { name: 'Ali Raza', role: 'LOADER' },
    period: { periodLabel: '2026-09', startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-30T23:59:59.999Z') },
    entry: {
      baseSalary: 30000, bonuses: 1000, overtime: 0, incentives: 0, advances: -5000, expenses: 0, penalties: 0,
      otherDeductions: -1000, carryForwardIn: 0, deferredIn: 2000, deferredOut: 500, finalPayable: 23500, status: 'APPROVED',
    },
    attendance,
  });

  it('renders a real single-page PDF buffer', async () => {
    const buf = await svc.generate(slip);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1500);
    expect((buf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
  });

  it('WORST case (every optional line, every note, every absence row, a draft stamp) is at most TWO A4 pages (the absence table adds a row per day)', async () => {
    const worst = buildSalarySlip({
      vendorName: 'x',
      employee: { name: 'A Very Long Employee Name Of Some Person', role: 'SALESMAN' },
      period: { periodLabel: '2026-09', startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-30T23:59:59.999Z') },
      entry: {
        baseSalary: 30000, bonuses: 1, overtime: 2, incentives: 3, advances: -4, expenses: 5, penalties: -6,
        otherDeductions: -7, carryForwardIn: 8, deferredIn: 9, deferredOut: 10, finalPayable: -12345, status: 'DRAFT',
      },
      attendance: {
        ...attendance,
        days: [
          ...attendance.days,
          { date: new Date('2026-09-06T00:00:00Z'), status: 'ABSENT', decision: 'DEDUCTED', deductedAmount: 500, deductionDeferred: true },
        ],
      },
    });
    const buf = await svc.generate(worst);
    expect((buf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it('prints the deduction statement + per-day absence table, flowing onto extra pages when long', async () => {
    const items = Array.from({ length: 80 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 8, 1 + (i % 28))),
      group: i % 2 ? 'Crew cash' : 'Absence deductions',
      description: i % 2 ? 'Meal - daily sheet 2026-09-0' + (i % 9) + ' - lunch for the crew on a long route' : 'Absent on 2026-09-02',
      amount: -100,
    }));
    const slip = buildSalarySlip({
      vendorName: 'x',
      employee: { name: 'Ali', role: 'LOADER' },
      period: { periodLabel: '2026-09', startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-30T23:59:59.999Z') },
      entry: {
        baseSalary: 35000, bonuses: 0, overtime: 0, incentives: 0, advances: 0, expenses: 0, penalties: 0,
        otherDeductions: -8000, carryForwardIn: 0, deferredIn: 0, deferredOut: 0, finalPayable: 27000, status: 'APPROVED',
      },
      attendance,
      deductions: items,
    });
    expect(slip.lines.find((l) => l.label === 'Crew cash')?.amount).toBe(-4000);
    expect(slip.lines.find((l) => l.label === 'Absence deductions')?.amount).toBe(-4000);
    expect(slip.lines.some((l) => l.label === 'Other deductions')).toBe(false);
    const buf = await svc.generate(slip);
    expect((buf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it('copes with DAILY/WEEKLY staff (no per-day decisions) and zero absences', async () => {
    const daily = { ...slip, absence: { ...slip.absence, decisionsApply: false } };
    const none = { ...slip, absence: { ...slip.absence, absentDays: 0, halfDays: 0 } };
    await expect(svc.generate(daily)).resolves.toBeInstanceOf(Buffer);
    await expect(svc.generate(none)).resolves.toBeInstanceOf(Buffer);
  });
});
