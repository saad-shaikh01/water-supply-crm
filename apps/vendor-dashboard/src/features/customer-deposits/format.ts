import type { DepositEntryDirection, DepositPaymentMethod, DepositType } from './api/customer-deposits.api';
import { PKT_TIME_ZONE } from '../../lib/date-pkt';

/** `₨ 1,250.5` — unsigned Rs. amount. */
export const fmtDepositCash = (n: number | null | undefined): string =>
  `₨ ${Math.abs(Number(n ?? 0)).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;

/** For a BOTTLE deposit — a plain count, no currency symbol. */
export const fmtDepositBottles = (n: number | null | undefined): string =>
  `${Math.abs(Number(n ?? 0)).toLocaleString('en-PK')} bottle${Math.abs(Number(n ?? 0)) === 1 ? '' : 's'}`;

/** Formats a deposit balance/amount per its type — Rs. for CASH, a bottle count for BOTTLE. */
export const fmtDepositAmount = (type: DepositType, n: number | null | undefined): string =>
  type === 'CASH' ? fmtDepositCash(n) : fmtDepositBottles(n);

export const DEPOSIT_DIRECTION_LABELS: Record<DepositEntryDirection, string> = {
  COLLECT: 'Collected',
  REFUND: 'Refunded',
  WRITE_OFF: 'Written off',
  APPLIED_TO_BALANCE: 'Applied to balance',
};

export const DEPOSIT_PAYMENT_METHOD_LABELS: Record<DepositPaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  ONLINE: 'Online',
};

/** COLLECT raises the held deposit (+); everything else lowers it (−). */
export const depositDirectionSign = (direction: DepositEntryDirection): '+' | '−' =>
  direction === 'COLLECT' ? '+' : '−';

export const fmtDepositDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', timeZone: PKT_TIME_ZONE });

export const fmtDepositDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: PKT_TIME_ZONE,
  });

/** Display title for a deposit row — "Cash Deposit" or "19L Deposit". */
export const depositTitle = (deposit: { type: DepositType; product: { name: string } | null }): string =>
  deposit.type === 'CASH' ? 'Cash Deposit' : `${deposit.product?.name ?? 'Bottle'} Deposit`;
