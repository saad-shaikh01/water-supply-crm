import * as fs from 'fs';
import * as path from 'path';
import { SalaryReceiptPdfService } from './salary-receipt-pdf.service';
import { buildSalarySlip, receiptFilename, type SlipAttendanceInput } from './payroll-slip.util';

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
const period = { periodLabel: '2026-09', startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-30T23:59:59.999Z') };
const pages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;

describe('SalaryReceiptPdfService', () => {
  const svc = new SalaryReceiptPdfService();

  it('renders a real single-page A5 PDF', async () => {
    const slip = buildSalarySlip({
      vendorName: 'Blue Ice',
      employee: { name: 'Ali Raza', role: 'LOADER' },
      period,
      entry: {
        baseSalary: 30000, bonuses: 1000, overtime: 0, incentives: 0, advances: -5000, expenses: 0, penalties: -720,
        otherDeductions: -1000, carryForwardIn: 0, deferredIn: 0, deferredOut: 0, finalPayable: 24280, status: 'APPROVED',
      },
      attendance,
      deductions: [{ date: new Date('2026-09-02T00:00:00Z'), group: 'Absence deductions', description: 'Absent', amount: -1000 }],
    });
    const buf = await svc.generate(slip);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(buf)).toBe(1);
    // Optional visual check: RECEIPT_PDF_OUT=./receipt.pdf npx jest salary-receipt-pdf
    if (process.env.RECEIPT_PDF_OUT) fs.writeFileSync(path.resolve(process.env.RECEIPT_PDF_OUT), buf);
  });

  it('WORST case (every optional line, long name, draft stamp, undecided absences) still fits ONE page', async () => {
    const slip = buildSalarySlip({
      vendorName: 'x',
      employee: { name: 'A Very Long Employee Name Of Some Person', role: 'SALESMAN' },
      period,
      entry: {
        baseSalary: 30000, bonuses: 1, overtime: 2, incentives: 3, advances: -4, expenses: 5, penalties: -6,
        otherDeductions: -7, carryForwardIn: 8, deferredIn: 9, deferredOut: 10, finalPayable: -12345, status: 'DRAFT',
      },
      attendance,
      deductions: [
        { date: new Date('2026-09-02T00:00:00Z'), group: 'Crew cash', description: 'a', amount: -3 },
        { date: new Date('2026-09-02T00:00:00Z'), group: 'Absence deductions', description: 'b', amount: -2 },
        { date: new Date('2026-09-02T00:00:00Z'), group: 'Other deductions', description: 'c', amount: -1 },
        { date: new Date('2026-09-02T00:00:00Z'), group: 'Adjustments & corrections', description: 'd', amount: -1 },
      ],
    });
    expect(pages(await svc.generate(slip))).toBe(1);
  });

  it('file name', () => {
    expect(receiptFilename('Ali Raza', '2026-09')).toBe('Salary-Receipt-2026-09-Ali-Raza.pdf');
  });
});
