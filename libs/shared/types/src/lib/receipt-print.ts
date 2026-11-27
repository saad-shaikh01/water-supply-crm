/**
 * Payloads for client-side (thermal) receipt printing.
 * See docs/features/thermal-receipt-printing.md.
 */

/** One delivery's frozen figures — the same snapshot the PDF / WhatsApp receipt prints. */
export interface ReceiptPrintData {
  customerName: string;
  customerCode: string;
  productName: string;
  van?: string;
  filledDropped: number;
  emptyReceived: number;
  filledReceived: number;
  cashCollected: number;
  pricePerBottle: number;
  /** (delivered − filled taken back) × price. */
  deliveryAmount: number;
  /** Positive = customer owes; negative = advance / credit. */
  financialBalanceAfter: number;
  bottleBalanceAfter: number;
  /** YYYY-MM-DD */
  deliveryDate: string;
  deliveryTime: string;
  /** MONTHLY customers only. */
  previousMonthOutstanding?: number;
  depositCash: number;
  depositBottles: number;
}

export interface ReceiptPrintPaymentAccount {
  kind: 'BANK' | 'EASYPAISA' | 'JAZZCASH' | 'RAAST';
  accountTitle: string;
  accountNumber: string;
  bankName?: string | null;
  iban?: string | null;
  branch?: string | null;
}

/** The vendor identity printed on the receipt. A missing field means "omit that line". */
export interface ReceiptPrintBranding {
  name: string;
  payTo: string;
  address: string | null;
  phones: string | null;
  email: string | null;
  website: string | null;
  taxLine: string | null;
  footerNote: string | null;
  paymentAccounts: ReceiptPrintPaymentAccount[];
  /** PNG / JPEG as a data URL, or null when the vendor has no logo. */
  logoDataUrl: string | null;
  /** False when the vendor has not saved a company profile yet (a fallback identity is printed). */
  profileConfigured: boolean;
}
