// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { DeliveryReceiptPdfService, DeliveryReceiptData } from './delivery-receipt-pdf.service';
import { neutralBranding } from '../../common/pdf/doc-branding';

function captureText(): { texts: string[]; restore: () => void } {
  const texts: string[] = [];
  const original = PDFDocument.prototype.text;
  const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: any, ...args: any[]) {
    if (typeof args[0] === 'string') texts.push(args[0]);
    return original.apply(this, args as any);
  } as any);
  return { texts, restore: () => spy.mockRestore() };
}

const receipt: DeliveryReceiptData = {
  customerName: 'Ali',
  customerCode: 'L1',
  productName: '19L Bottle',
  filledDropped: 2,
  emptyReceived: 2,
  cashCollected: 0,
  pricePerBottle: 100,
  financialBalanceAfter: 200,
  bottleBalanceAfter: 0,
  deliveryDate: '2026-08-01',
  deliveryTime: '10:00',
  vendorName: 'Lorem Water',
};

describe('DeliveryReceiptPdfService — P0 branding', () => {
  const svc = new DeliveryReceiptPdfService();

  it('default (legacy) keeps the Dasani identity + payment block unchanged', async () => {
    const cap = captureText();
    const buf = await svc.generate(receipt);
    cap.restore();
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const all = cap.texts.join('\n');
    expect(all).toContain('DASANI ENTERPRISES');
    expect(all).toContain('9933-0104414597');
    expect(all).toContain('Please make all payments to DASANI ENTERPRISES');
  });

  it("neutral branding shows only the vendor and never another vendor's bank/contact details", async () => {
    const cap = captureText();
    const buf = await svc.generate(receipt, neutralBranding('Lorem Water'));
    cap.restore();
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const all = cap.texts.join('\n');
    expect(all).toContain('Lorem Water');
    expect(all).toContain('Thank you for your business with us!');
    for (const forbidden of ['DASANI', 'Meezan', '9933-', '03162677954', 'blueice', 'Please make all payments', 'FOR ONLINE PAYMENTS', '0316-2677954']) {
      expect(all).not.toContain(forbidden);
    }
  });
});
