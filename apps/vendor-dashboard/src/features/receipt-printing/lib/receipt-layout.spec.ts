import type { ReceiptPrintBranding, ReceiptPrintData } from '@water-supply-crm/types';
import {
  balanceLabel, buildReceiptBlocks, buildTestBlocks, formatReceiptDate, formatRupees, type ReceiptBlock,
} from './receipt-layout';

const data: ReceiptPrintData = {
  customerName: 'Nafeesa Begum', customerCode: 'B0235', productName: '19L Bottle', van: 'V1',
  filledDropped: 3, emptyReceived: 2, filledReceived: 0, cashCollected: 300, pricePerBottle: 200,
  deliveryAmount: 600, financialBalanceAfter: 300, bottleBalanceAfter: 4,
  deliveryDate: '2026-11-20', deliveryTime: '08:54 am', depositCash: 0, depositBottles: 0,
};
const branding: ReceiptPrintBranding = {
  name: 'LOREM WATER', payTo: 'LOREM BEVERAGES', address: '12 Canal Road', phones: '0300-1111111',
  email: 'hi@lorem.pk', website: 'lorem.pk', taxLine: 'NTN: 1', footerNote: 'No returns.',
  logoDataUrl: 'data:image/png;base64,AAAA', profileConfigured: true,
  paymentAccounts: [
    { kind: 'BANK', accountTitle: 'Lorem', accountNumber: '1234', bankName: 'HBL', branch: 'Canal', iban: 'PK36X' },
    { kind: 'JAZZCASH', accountTitle: 'Lorem', accountNumber: '0301' },
    { kind: 'RAAST', accountTitle: 'Lorem', accountNumber: '0302' },
  ],
};

const lines = (blocks: ReceiptBlock[]) =>
  blocks.map((b) => (b.kind === 'text' ? b.text : b.kind === 'row' ? `${b.label}: ${b.value}` : b.kind));

describe('formatting', () => {
  it('formats rupees with grouping, sign and no "-0"', () => {
    expect(formatRupees(6399)).toBe('Rs. 6,399');
    expect(formatRupees(10.5)).toBe('Rs. 10.5');
    expect(formatRupees(-200)).toBe('-Rs. 200');
    expect(formatRupees(-0.000001)).toBe('Rs. 0');
  });

  it('formats the date and labels the balance', () => {
    expect(formatReceiptDate('2026-11-20')).toBe('20-11-2026');
    expect(formatReceiptDate('garbage')).toBe('garbage');
    expect(balanceLabel(5)).toBe('TOTAL OUTSTANDING BALANCE');
    expect(balanceLabel(0)).toBe('NO OUTSTANDING BALANCE');
    expect(balanceLabel(-5)).toBe('ADVANCE / CREDIT BALANCE');
  });
});

describe('buildReceiptBlocks', () => {
  it('prints the vendor identity, delivery figures, every payment account and the footer', () => {
    const out = lines(buildReceiptBlocks(data, branding));
    expect(out).toEqual(expect.arrayContaining([
      'logo', 'LOREM WATER', '12 Canal Road', '0300-1111111',
      'Date: 20-11-2026', 'Time: 08:54 am', 'Customer: Nafeesa Begum', 'Code: B0235', 'Van: V1',
      'Product: 19L Bottle', 'Price / Bottle: Rs. 200', 'Bottles Delivered: 3', 'Empty Received: 2',
      'Balance Bottles: 4', 'Deposit: Rs. 0 / 0 btl', 'Delivery Amount: Rs. 600', 'Cash Collected: Rs. 300',
      'TOTAL OUTSTANDING BALANCE', 'Rs. 300', 'Please make all payments to LOREM BEVERAGES',
      'BANK TRANSFER: HBL - Canal', 'A/C: 1234', 'IBAN: PK36X', 'JAZZCASH', 'A/C: 0301', 'RAAST', 'A/C: 0302',
      'lorem.pk', 'hi@lorem.pk', 'NTN: 1', 'No returns.',
    ]));
  });

  it('omits everything that is not set, instead of printing placeholders', () => {
    const bare: ReceiptPrintBranding = {
      name: 'PLAIN', payTo: 'PLAIN', address: null, phones: null, email: null, website: null, taxLine: null,
      footerNote: null, paymentAccounts: [], logoDataUrl: null, profileConfigured: true,
    };
    const out = lines(buildReceiptBlocks({ ...data, van: undefined }, bare));
    expect(out).not.toContain('logo');
    expect(out.join('\n')).not.toMatch(/payments|IBAN|Van|Filled Received|Prev\. Month|null|undefined/);
  });

  it('shows returned filled bottles and the previous month, wording an advance as an advance', () => {
    const due = lines(buildReceiptBlocks({ ...data, filledReceived: 1, previousMonthOutstanding: 450 }, branding));
    expect(due).toContain('Filled Received: 1');
    expect(due).toContain('Prev. Month Due: Rs. 450');

    const advance = lines(buildReceiptBlocks({ ...data, previousMonthOutstanding: -90, financialBalanceAfter: -60 }, branding));
    expect(advance).toContain('Prev. Month Advance: Rs. 90');
    expect(advance).toContain('ADVANCE / CREDIT BALANCE');
    expect(advance).toContain('Rs. 60');
  });
});

describe('buildTestBlocks', () => {
  it('is clearly marked as a sample but carries the real vendor header', () => {
    const out = lines(buildTestBlocks(branding));
    expect(out).toEqual(expect.arrayContaining(['LOREM WATER', 'TEST PRINT', 'Sample only - not a receipt']));
  });
});
