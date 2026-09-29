import { apiClient } from '@water-supply-crm/data-access';

/**
 * Customer Deposits (owner-requested 2026-09-29) — an optional, per-customer
 * refundable security deposit. Mirrors, field for field, the API shapes in
 * `customer-deposits.service.ts` / `customer-deposits.controller.ts`.
 */

export type DepositType = 'CASH' | 'BOTTLE';
export type DepositEntryDirection = 'COLLECT' | 'REFUND' | 'WRITE_OFF' | 'APPLIED_TO_BALANCE';
export type DepositEntrySource = 'OFFICE' | 'DELIVERY';
export type DepositEntryStatus = 'POSTED' | 'VOIDED';

export interface CustomerDepositEntry {
  id: string;
  depositId: string;
  direction: DepositEntryDirection;
  /** Always positive; Rs. for CASH deposits, bottle-count for BOTTLE deposits. */
  amount: number;
  source: DepositEntrySource;
  status: DepositEntryStatus;
  effectiveDate: string;
  note: string | null;
  referenceNo: string | null;
  dailySheetItemId: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  voidedAt: string | null;
  voidedBy: { id: string; name: string } | null;
  voidReason: string | null;
  reversalOf: { id: string; direction: DepositEntryDirection; amount: number; effectiveDate: string } | null;
  reversedBy: { id: string; direction: DepositEntryDirection; amount: number; effectiveDate: string } | null;
}

export interface CustomerDeposit {
  id: string;
  customerId: string;
  type: DepositType;
  productId: string | null;
  product: { id: string; name: string } | null;
  /** Rs. for CASH, bottle-count for BOTTLE. */
  balance: number;
  entries: CustomerDepositEntry[];
  createdAt: string;
}

export interface CollectDepositPayload {
  type: DepositType;
  /** Required (and only meaningful) when type = BOTTLE. */
  productId?: string;
  amount: number;
  effectiveDate?: string;
  note?: string;
  referenceNo?: string;
}

export interface RefundDepositPayload {
  amount: number;
  effectiveDate?: string;
  note?: string;
  referenceNo?: string;
}

export interface ApplyDepositToBalancePayload {
  amount: number;
  effectiveDate?: string;
  note?: string;
}

export interface WriteOffDepositPayload {
  amount: number;
  effectiveDate?: string;
  /** Mandatory, at least 5 characters. */
  note: string;
}

export interface DepositActionResult {
  deposit: CustomerDeposit;
  entry: CustomerDepositEntry;
}

export interface ApplyToBalanceResult extends DepositActionResult {
  adjustmentId: string;
}

export interface VoidDepositEntryResult {
  entry: CustomerDepositEntry;
  reversal: CustomerDepositEntry;
  deposit: CustomerDeposit;
}

export const customerDepositsApi = {
  getConfig: () => apiClient.get<{ depositsEnabled: boolean }>('/customer-deposits/config'),
  updateConfig: (depositsEnabled: boolean) =>
    apiClient.patch<{ depositsEnabled: boolean }>('/customer-deposits/config', { depositsEnabled }),

  listForCustomer: (customerId: string) =>
    apiClient.get<CustomerDeposit[]>(`/customers/${customerId}/deposits`),

  collect: (customerId: string, payload: CollectDepositPayload) =>
    apiClient.post<DepositActionResult>(`/customers/${customerId}/deposits/collect`, payload),

  refund: (depositId: string, payload: RefundDepositPayload) =>
    apiClient.post<DepositActionResult>(`/customer-deposits/${depositId}/refund`, payload),

  applyToBalance: (depositId: string, payload: ApplyDepositToBalancePayload) =>
    apiClient.post<ApplyToBalanceResult>(`/customer-deposits/${depositId}/apply-to-balance`, payload),

  writeOff: (depositId: string, payload: WriteOffDepositPayload) =>
    apiClient.post<DepositActionResult>(`/customer-deposits/${depositId}/write-off`, payload),

  voidEntry: (entryId: string, reason: string) =>
    apiClient.post<VoidDepositEntryResult>(`/customer-deposit-entries/${entryId}/void`, { reason }),
};

/**
 * The message a failed request should show. Nest's ValidationPipe answers with an ARRAY of
 * messages for DTO errors and a plain string for business-rule errors — handle both.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const raw = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message;
  const message = Array.isArray(raw) ? raw.join(' ') : raw;
  return message || fallback;
}
