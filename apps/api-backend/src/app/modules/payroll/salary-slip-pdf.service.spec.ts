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

  it('WORST case (every optional line, every note, every absence row, a draft stamp) still fits ONE A4 page', async () => {
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
    expect((buf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
  });

  it('copes with DAILY/WEEKLY staff (no per-day decisions) and zero absences', async () => {
    const daily = { ...slip, absence: { ...slip.absence, decisionsApply: false } };
    const none = { ...slip, absence: { ...slip.absence, absentDays: 0, halfDays: 0 } };
    await expect(svc.generate(daily)).resolves.toBeInstanceOf(Buffer);
    await expect(svc.generate(none)).resolves.toBeInstanceOf(Buffer);
  });
});
