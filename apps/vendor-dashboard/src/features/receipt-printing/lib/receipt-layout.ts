/**
 * What a thermal receipt says, as a list of blocks. Pure: no DOM, no canvas.
 * Same figures and labels as the A5 PDF receipt, minus anything that relied on colour.
 */
import type {
  ReceiptPrintBranding,
  ReceiptPrintData,
  ReceiptPrintPaymentAccount,
} from '@water-supply-crm/types';

export type TextSize = 'sm' | 'md' | 'lg' | 'xl';

export type ReceiptBlock =
  | { kind: 'logo' }
  | { kind: 'text'; text: string; size: TextSize; bold?: boolean; align?: 'left' | 'center' }
  | { kind: 'row'; label: string; value: string; bold?: boolean }
  | { kind: 'divider' };

const KIND_TITLES: Record<ReceiptPrintPaymentAccount['kind'], string> = {
  BANK: 'BANK TRANSFER',
  EASYPAISA: 'EASYPAISA',
  JAZZCASH: 'JAZZCASH',
  RAAST: 'RAAST',
};

export function formatRupees(amount: number): string {
  const digits = Math.abs(amount).toLocaleString('en-US', { maximumFractionDigits: 2 });
  // The sign is decided after rounding, so a floating-point residue never prints as "-Rs. 0".
  return amount < 0 && digits !== '0' ? `-Rs. ${digits}` : `Rs. ${digits}`;
}

/** YYYY-MM-DD → DD-MM-YYYY. */
export function formatReceiptDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : isoDate;
}

export function balanceLabel(balance: number): string {
  if (balance < 0) return 'ADVANCE / CREDIT BALANCE';
  if (balance === 0) return 'NO OUTSTANDING BALANCE';
  return 'TOTAL OUTSTANDING BALANCE';
}

const center = (text: string, size: TextSize = 'sm', bold = false): ReceiptBlock => ({
  kind: 'text', text, size, bold, align: 'center',
});
const row = (label: string, value: string, bold = false): ReceiptBlock => ({ kind: 'row', label, value, bold });
const divider: ReceiptBlock = { kind: 'divider' };

function headerBlocks(b: ReceiptPrintBranding): ReceiptBlock[] {
  return [
    ...(b.logoDataUrl ? [{ kind: 'logo' } as const] : []),
    center(b.name, 'lg', true),
    ...(b.address ? [center(b.address)] : []),
    ...(b.phones ? [center(b.phones)] : []),
    divider,
  ];
}

function paymentBlocks(b: ReceiptPrintBranding): ReceiptBlock[] {
  if (!b.paymentAccounts.length) return [];
  const blocks: ReceiptBlock[] = [divider, center(`Please make all payments to ${b.payTo}`)];
  for (const account of b.paymentAccounts) {
    const bank = [account.bankName, account.branch].filter(Boolean).join(' - ');
    const left = (text: string, bold = false): ReceiptBlock => ({ kind: 'text', text, size: 'sm', bold });
    blocks.push(left([KIND_TITLES[account.kind], bank].filter(Boolean).join(': '), true));
    blocks.push(left(`Title: ${account.accountTitle}`));
    blocks.push(left(`A/C: ${account.accountNumber}`, true));
    if (account.iban) blocks.push(left(`IBAN: ${account.iban}`));
  }
  return blocks;
}

function footerBlocks(b: ReceiptPrintBranding): ReceiptBlock[] {
  const lines = [b.website, b.email, b.taxLine, b.footerNote].filter((l): l is string => !!l);
  return [
    divider,
    center('Thank you for your business!', 'md', true),
    ...paymentBlocks(b),
    ...(lines.length ? [divider, ...lines.map((l) => center(l))] : []),
  ];
}

export function buildReceiptBlocks(data: ReceiptPrintData, branding: ReceiptPrintBranding): ReceiptBlock[] {
  const previous = data.previousMonthOutstanding;
  return [
    ...headerBlocks(branding),
    center('DELIVERY RECEIPT', 'md', true),
    row('Date', formatReceiptDate(data.deliveryDate)),
    row('Time', data.deliveryTime),
    row('Customer', data.customerName, true),
    row('Code', data.customerCode),
    ...(data.van ? [row('Van', data.van)] : []),
    divider,
    row('Product', data.productName),
    row('Price / Bottle', formatRupees(data.pricePerBottle)),
    row('Bottles Delivered', `${data.filledDropped}`, true),
    row('Empty Received', `${data.emptyReceived}`),
    ...(data.filledReceived ? [row('Filled Received', `${data.filledReceived}`)] : []),
    row('Balance Bottles', `${data.bottleBalanceAfter}`, true),
    row('Deposit', `${formatRupees(data.depositCash)} / ${data.depositBottles} btl`),
    divider,
    row('Delivery Amount', formatRupees(data.deliveryAmount), true),
    row('Cash Collected', formatRupees(data.cashCollected), true),
    ...(previous != null
      ? [row(previous < 0 ? 'Prev. Month Advance' : 'Prev. Month Due', formatRupees(Math.abs(previous)))]
      : []),
    divider,
    center(balanceLabel(data.financialBalanceAfter), 'md', true),
    center(formatRupees(Math.abs(data.financialBalanceAfter)), 'xl', true),
    ...footerBlocks(branding),
  ];
}

/** Printer setup: the vendor's real header and footer around obviously fake figures. */
export function buildTestBlocks(branding: ReceiptPrintBranding): ReceiptBlock[] {
  return [
    ...headerBlocks(branding),
    center('TEST PRINT', 'lg', true),
    center('Sample only - not a receipt'),
    row('Customer', 'Sample Customer'),
    row('Bottles Delivered', '2'),
    row('Delivery Amount', formatRupees(400), true),
    row('Cash Collected', formatRupees(400)),
    ...footerBlocks(branding),
  ];
}
