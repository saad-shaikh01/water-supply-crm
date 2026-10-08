/**
 * A non-Dasani vendor with a full company profile: every document must print THEIR details and
 * nothing of Dasani's, fit its page, and cope with a vendor-uploaded logo.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { CustomerStatementPdfService } from '../../modules/customer/pdf/customer-statement-pdf.service';
import { DeliveryReceiptPdfService } from '../../modules/whatsapp/delivery-receipt-pdf.service';
import { SalarySlipPdfService } from '../../modules/payroll/salary-slip-pdf.service';
import { buildSalarySlip } from '../../modules/payroll/payroll-slip.util';
import { DailySheetPdfService } from '../../modules/daily-sheet/pdf/daily-sheet-pdf.service';
import type { DocBranding } from './doc-branding';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const lorem: DocBranding = {
  name: 'LOREM WATER',
  payTo: 'LOREM BEVERAGES (PVT) LTD',
  address: '12 Canal Road, Lahore',
  phones: 'Cell# 0300-1111111',
  email: 'hello@lorem.pk',
  website: 'lorem.pk',
  taxLine: 'NTN: 1234567-8',
  logo: PNG,
  icon: null,
  gradient: { light: '#a7f3d0', dark: '#065f46' },
  paymentAccounts: [
    { kind: 'BANK', accountTitle: 'LOREM BEVERAGES', bankName: 'HBL', branch: 'Canal', accountNumber: '1234-5678', iban: 'PK36SCBL0000001123456702' },
    { kind: 'EASYPAISA', accountTitle: 'LOREM BEVERAGES', accountNumber: '03001111111' },
    { kind: 'JAZZCASH', accountTitle: 'LOREM BEVERAGES', accountNumber: '03011111111' },
    { kind: 'RAAST', accountTitle: 'LOREM BEVERAGES', accountNumber: '03021111111' },
  ],
  footerNote: 'Goods once sold are not returnable.',
};

const FORBIDDEN = ['DASANI', 'Dasani', 'Meezan', '9933-', '03162677954', 'blueice', '0316-2677954', '0345-2364698', 'Gulshan'];

async function capture(render: () => Promise<Buffer>): Promise<{ texts: string; pages: number }> {
  const texts: string[] = [];
  const original = PDFDocument.prototype.text;
  const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: any, ...args: any[]) {
    if (typeof args[0] === 'string') texts.push(args[0]);
    return original.apply(this, args as any);
  } as any);
  let buf: Buffer;
  try {
    buf = await render();
  } finally {
    spy.mockRestore();
  }
  return { texts: texts.join('\n'), pages: (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length };
}

describe('documents rendered for a non-Dasani vendor', () => {
  it('statement: own identity + all four payment accounts + footer lines, nothing of Dasani', async () => {
    const { texts } = await capture(() =>
      new CustomerStatementPdfService().generate({
        customer: { name: 'Ali', customerCode: 'L1', address: 'Street 1', phoneNumber: '923001234567', paymentType: 'MONTHLY' },
        transactions: [], openingBalance: 0, closingBalance: 500, period: 'August 2026', month: '2026-08', branding: lorem,
      }),
    );
    for (const want of ['LOREM WATER', '12 Canal Road, Lahore', 'Cell# 0300-1111111', 'Please make all payments to LOREM BEVERAGES (PVT) LTD',
      'BANK TRANSFER', 'HBL - Canal', '1234-5678', 'PK36SCBL0000001123456702', 'EASYPAISA', '03001111111', 'JAZZCASH', '03011111111', 'RAAST', '03021111111',
      'lorem.pk', 'hello@lorem.pk', 'NTN: 1234567-8', 'Goods once sold are not returnable.']) {
      expect(texts).toContain(want);
    }
    for (const bad of FORBIDDEN) expect(texts).not.toContain(bad);
  });

  it('receipt: A5 stays ONE page with four configured accounts — first two as cards (no IBAN row), the rest point to the statement', async () => {
    const { texts, pages } = await capture(() =>
      new DeliveryReceiptPdfService().generate(
        {
          customerName: 'Ali', customerCode: 'L1', productName: '19L Bottle', van: 'V1', filledDropped: 2, emptyReceived: 2,
          cashCollected: 0, pricePerBottle: 100, financialBalanceAfter: 200, bottleBalanceAfter: 0,
          deliveryDate: '2026-08-01', deliveryTime: '10:00', vendorName: 'LOREM WATER',
        },
        lorem,
      ),
    );
    expect(pages).toBe(1);
    expect(texts).toContain('1234-5678');
    expect(texts).toContain('03001111111');
    expect(texts).toContain('FOR ONLINE PAYMENTS  (more options on your statement)');
    expect(texts).not.toContain('03021111111'); // 4th account lives on the statement only
    for (const bad of FORBIDDEN) expect(texts).not.toContain(bad);
  });

  it('salary slip and daily sheet carry the vendor identity (and still fit their pages)', async () => {
    const slip = buildSalarySlip({
      vendorName: 'LOREM WATER',
      employee: { name: 'Ali Raza', role: 'LOADER' },
      period: { periodLabel: '2026-09', startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-30T23:59:59.999Z') },
      entry: { baseSalary: 30000, bonuses: 0, overtime: 0, incentives: 0, advances: 0, expenses: 0, penalties: 0, otherDeductions: 0, carryForwardIn: 0, deferredIn: 0, deferredOut: 0, finalPayable: 30000, status: 'APPROVED' },
      attendance: { decisionsApply: false, periodDayCount: 30, presentDays: 30, absentDays: 0, halfDays: 0, leaveDays: 0, days: [] },
    });
    const s = await capture(() => new SalarySlipPdfService().generate(slip, lorem));
    expect(s.pages).toBe(1);
    expect(s.texts).toContain('LOREM WATER');
    expect(s.texts).toContain('lorem.pk');
    for (const bad of FORBIDDEN) expect(s.texts).not.toContain(bad);

    const d = await capture(() =>
      new DailySheetPdfService().generate(
        { id: 'abcdef12-0000-0000-0000-000000000000', date: new Date('2026-08-03T00:00:00Z'), isClosed: false, crewConfirmed: true, van: { plateNumber: 'V1' }, salesman: { name: 'S' }, crew: [], items: [], loads: [], expenses: [] },
        lorem,
      ),
    );
    expect(d.texts).toContain('LOREM WATER');
    expect(d.texts).toContain('12 Canal Road, Lahore');
    expect(d.texts).toMatch(/LOREM WATER · Generated/);
    for (const bad of FORBIDDEN) expect(d.texts).not.toContain(bad);
  });

  it('a vendor with no payment accounts prints no payment block and no "pay to" line', async () => {
    const { texts } = await capture(() =>
      new DeliveryReceiptPdfService().generate(
        { customerName: 'Ali', customerCode: 'L1', productName: 'P', filledDropped: 1, emptyReceived: 1, cashCollected: 0, pricePerBottle: 100, financialBalanceAfter: 100, bottleBalanceAfter: 0, deliveryDate: '2026-08-01', deliveryTime: '10:00', vendorName: 'X' },
        { ...lorem, paymentAccounts: [], footerNote: null },
      ),
    );
    expect(texts).not.toContain('FOR ONLINE PAYMENTS');
    expect(texts).not.toMatch(/Please make all payments/);
    expect(texts).toContain('Thank you for your business with us!');
  });
});
