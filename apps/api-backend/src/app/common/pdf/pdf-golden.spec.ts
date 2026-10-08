/**
 * Golden-text regression for the Dasani / Blue Ice documents (multi-vendor design doc §4 "Safety nets").
 *
 * Every string the four PDF services draw is captured (pdfkit compresses streams, so we spy on
 * `text()`), and compared to the fixture recorded BEFORE the branding refactor. If this fails,
 * Blue Ice's customer-facing documents changed — that must be a deliberate, reviewed change:
 * regenerate with `GOLDEN_WRITE=1 npx jest -c jest.config.cts pdf-golden`.
 *
 * Known deliberate change recorded in the fixture: the daily-sheet header address now matches the
 * other documents (owner decision 2026-10-08: one Dasani address everywhere).
 */
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { CustomerStatementPdfService } from '../../modules/customer/pdf/customer-statement-pdf.service';
import { DeliveryReceiptPdfService } from '../../modules/whatsapp/delivery-receipt-pdf.service';
import { SalarySlipPdfService } from '../../modules/payroll/salary-slip-pdf.service';
import { buildSalarySlip } from '../../modules/payroll/payroll-slip.util';
import { DailySheetPdfService } from '../../modules/daily-sheet/pdf/daily-sheet-pdf.service';
import { LEGACY_DOC_BRANDING } from './legacy-dasani-branding';

const FIXTURE = path.join(__dirname, '__golden__', 'dasani-pdf-text.json');

async function captureTexts(render: () => Promise<Buffer>): Promise<string[]> {
  const texts: string[] = [];
  const original = PDFDocument.prototype.text;
  const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: any, ...args: any[]) {
    if (typeof args[0] === 'string') texts.push(args[0]);
    return original.apply(this, args as any);
  } as any);
  try {
    await render();
  } finally {
    spy.mockRestore();
  }
  // timestamps differ run to run
  return texts.map((t) => t.replace(/Generated .*?(?= ·|$)/, 'Generated <ts>'));
}

const statementData = {
  customer: { name: 'Ali Raza', customerCode: 'L0042', address: 'House 1, Street 2, Karachi', phoneNumber: '923001234567', paymentType: 'MONTHLY' },
  transactions: [
    { id: 't1', type: 'DELIVERY', amount: 480, createdAt: new Date('2026-08-03T05:00:00Z'), filledDropped: 2, emptyReceived: 2, description: 'Delivery', product: { name: '19L Bottle' }, dailySheetItem: { bottleBalanceAfter: 2 } },
    { id: 't2', type: 'PAYMENT', amount: -200, createdAt: new Date('2026-08-10T05:00:00Z'), description: 'Cash payment', product: null, dailySheetItem: null },
  ],
  openingBalance: 100,
  closingBalance: 380,
  period: 'August 2026',
  month: '2026-08',
  ratePerBottle: 240,
};

const receiptData = {
  customerName: 'Ali Raza',
  customerCode: 'L0042',
  productName: '19L Bottle',
  van: 'V1',
  filledDropped: 2,
  emptyReceived: 2,
  cashCollected: 200,
  pricePerBottle: 240,
  financialBalanceAfter: 380,
  bottleBalanceAfter: 2,
  deliveryDate: '2026-08-03',
  deliveryTime: '10:30',
  vendorName: 'Blue Ice',
  previousMonthOutstanding: 100,
};

const slip = buildSalarySlip({
  vendorName: 'Blue Ice',
  employee: { name: 'Ali Raza', role: 'LOADER' },
  period: { periodLabel: '2026-09', startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-30T23:59:59.999Z') },
  entry: {
    baseSalary: 30000, bonuses: 1000, overtime: 0, incentives: 0, advances: -5000, expenses: 0, penalties: 0,
    otherDeductions: -1000, carryForwardIn: 0, deferredIn: 2000, deferredOut: 500, finalPayable: 23500, status: 'APPROVED',
  },
  attendance: {
    decisionsApply: true, periodDayCount: 30, presentDays: 27, absentDays: 2, halfDays: 1, leaveDays: 0,
    days: [{ date: new Date('2026-09-02T00:00:00Z'), status: 'ABSENT', decision: 'DEDUCTED', deductedAmount: 1000 }],
  },
});

const sheet: any = {
  id: 'abcdef12-0000-0000-0000-000000000000',
  date: new Date('2026-08-03T00:00:00Z'),
  isClosed: false,
  crewConfirmed: true,
  van: { plateNumber: 'V1' },
  salesman: { name: 'Salman' },
  crew: [{ user: { name: 'Loader One' } }],
  items: [],
  loads: [],
  expenses: [],
};

describe('Dasani documents — golden text (must not change)', () => {
  it('statement, receipt, salary slip and daily sheet print exactly what they printed before the branding refactor', async () => {
    const actual = {
      statement: await captureTexts(() => new CustomerStatementPdfService().generate({ ...statementData, branding: LEGACY_DOC_BRANDING })),
      receipt: await captureTexts(() => new DeliveryReceiptPdfService().generate(receiptData, LEGACY_DOC_BRANDING)),
      salarySlip: await captureTexts(() => new SalarySlipPdfService().generate(slip, LEGACY_DOC_BRANDING)),
      dailySheet: await captureTexts(() => new DailySheetPdfService().generate(sheet, LEGACY_DOC_BRANDING)),
    };

    if (process.env['GOLDEN_WRITE'] === '1') {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, JSON.stringify(actual, null, 2) + '\n');
    }
    const expected = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    expect(actual).toEqual(expected);
  });
});
