// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { CustomerStatementPdfService } from './customer-statement-pdf.service';

/** Collects every string the service draws (pdfkit compresses streams, so assert on the text() calls). */
function captureText(): { texts: string[]; restore: () => void } {
  const texts: string[] = [];
  const original = PDFDocument.prototype.text;
  const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: any, ...args: any[]) {
    if (typeof args[0] === 'string') texts.push(args[0]);
    return original.apply(this, args as any);
  } as any);
  return { texts, restore: () => spy.mockRestore() };
}

const data = {
  customer: { name: 'Ali', customerCode: 'L1', address: 'Street 1', phoneNumber: '923001234567', paymentType: 'MONTHLY' },
  transactions: [],
  openingBalance: 0,
  closingBalance: 500,
  period: 'August 2026',
  month: '2026-08',
};

describe('CustomerStatementPdfService — P0 branding', () => {
  const svc = new CustomerStatementPdfService();

  it('no branding (legacy) still prints the Dasani identity + payment block exactly as before', async () => {
    const cap = captureText();
    const buf = await svc.generate(data);
    cap.restore();
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const all = cap.texts.join('\n');
    expect(all).toContain('DASANI ENTERPRISES');
    expect(all).toContain('Please make all payments to DASANI ENTERPRISES');
    expect(all).toContain('9933-0104414597');
    expect(all).toContain('Meezan Bank');
    expect(all).toContain('03162677954');
    expect(all).toContain('blueice.com.pk');
  });

  it('neutral branding prints only the vendor name/address — no Dasani identity, bank, wallet, contacts or "pay to"', async () => {
    const cap = captureText();
    const buf = await svc.generate({ ...data, branding: { legacy: false, name: 'Lorem Water', address: 'Lahore' } });
    cap.restore();
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const all = cap.texts.join('\n');
    expect(all).toContain('Lorem Water');
    expect(all).toContain('Lahore');
    expect(all).toContain('Thank you for your business with us!');
    for (const forbidden of ['DASANI', 'Dasani', 'Meezan', '9933-', '03162677954', 'blueice', 'Please make all payments', 'FOR ONLINE PAYMENTS', '0316-2677954', 'Gulshan']) {
      expect(all).not.toContain(forbidden);
    }
  });
});
