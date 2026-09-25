import { apiClient } from '@water-supply-crm/data-access';
import type {
  AdjustmentDirection,
  AdjustmentKind,
  AdjustmentStatus,
  AdjustmentVisibility,
} from '@water-supply-crm/types';

/**
 * Customer Financial Adjustments ("Charges & Credits") — read side.
 * Mirrors `GET /customer-financial-adjustments` (customer-financial-adjustment.service.ts
 * `ADJUSTMENT_READ_INCLUDE`). The endpoint is staff-facing and gated by
 * `customer_financial_adjustments:view`, so `internalNote` is included.
 */

/** A manual, non-delivery money event on a customer's account. `amount` is always positive; `direction` gives the sign. */
export interface CustomerAdjustment {
  id: string;
  customerId: string;
  kind: AdjustmentKind;
  /** CHARGE = the customer owes MORE; CREDIT = the customer owes LESS. */
  direction: AdjustmentDirection;
  amount: number;
  /** Business date (ISO). Becomes the ledger row's date. */
  effectiveDate: string;
  /** Staff-facing label; customer-visible only when `customerVisibility` is ITEMIZED. */
  title: string;
  /** Staff-only. Never shown to the customer. */
  internalNote: string | null;
  referenceNo: string | null;
  customerVisibility: AdjustmentVisibility;
  status: AdjustmentStatus;
  voidedAt: string | null;
  voidReason: string | null;
  /** Set on both legs of a balance transfer. */
  groupId: string | null;
  /** The other account of a transfer leg (display only). */
  counterpartyCustomerId: string | null;
  createdAt: string;
  customer: { id: string; name: string; customerCode: string };
  createdBy: { id: string; name: string } | null;
  voidedBy: { id: string; name: string } | null;
  /** On a REVERSAL: the adjustment it cancels. */
  reversalOf: { id: string; kind: AdjustmentKind; title: string; status: AdjustmentStatus; effectiveDate: string } | null;
  /** On a voided original: the reversal that cancelled it. */
  reversedBy: { id: string; kind: AdjustmentKind; status: AdjustmentStatus; effectiveDate: string } | null;
  /** The single ledger row this posted (signed amount) — exactly what the customer's statement shows. */
  transaction: { id: string; amount: number | null; description: string | null; createdAt: string } | null;
  /**
   * Linked Penalty (owner-approved 2026-09-25) — set only on a STAFF_FAULT_CREDIT
   * posted by LinkedPenaltyService alongside a staff penalty. Null when posted
   * standalone. Voidable only from the payroll side (see `isVoidable`).
   */
  causedByStaffLedgerEntry: { id: string; user: { id: string; name: string } } | null;
}

export interface CustomerAdjustmentQuery {
  page?: number;
  limit?: number;
  customerId?: string;
  kind?: AdjustmentKind;
  status?: AdjustmentStatus;
  /** Inclusive, vendor calendar day (YYYY-MM-DD). */
  dateFrom?: string;
  dateTo?: string;
}

export interface CustomerAdjustmentPage {
  data: CustomerAdjustment[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/**
 * Kinds a user can post ALONE through the create endpoint — everything except the two transfer
 * legs (own endpoint) and REVERSAL (only ever created by a void). Mirrors the backend's
 * POSTABLE_ADJUSTMENT_KINDS / the policy table's `creation: 'STANDALONE'`.
 */
export type PostableAdjustmentKind = Exclude<AdjustmentKind, 'TRANSFER_OUT' | 'TRANSFER_IN' | 'REVERSAL'>;

/**
 * POST /customer-financial-adjustments. The direction (charge vs credit) is decided by the backend
 * from `kind`; the ONLY kind where the caller sends one is CORRECTION (required there).
 */
export interface CreateAdjustmentPayload {
  customerId: string;
  kind: PostableAdjustmentKind;
  direction?: AdjustmentDirection;
  /** Positive rupees, at most 2 decimal places. */
  amount: number;
  title: string;
  /** Required for every credit, write-off and correction. Staff-only. */
  internalNote?: string;
  referenceNo?: string;
  /** YYYY-MM-DD. Omit for "now"; earlier only within the current month. */
  effectiveDate?: string;
  /** One per submit — a retry or double-click with the same key returns the original result. */
  idempotencyKey: string;
}

export interface CreateAdjustmentResult {
  adjustment: { id: string; kind: AdjustmentKind; direction: AdjustmentDirection; amount: number; title: string };
  transaction: { id: string; amount: number | null };
  /** The customer's balance right after posting (the live balance on a replay). */
  customerBalance: number;
  /** True when this key was already used with the same request: nothing new was posted. */
  idempotentReplay: boolean;
}

export interface VoidAdjustmentResult {
  adjustment: { id: string; status: AdjustmentStatus };
  reversal: { id: string };
  customerBalance: number;
}

export const customerAdjustmentsApi = {
  list: (params: CustomerAdjustmentQuery) =>
    apiClient.get<CustomerAdjustmentPage>('/customer-financial-adjustments', { params }),
  create: (payload: CreateAdjustmentPayload) =>
    apiClient.post<CreateAdjustmentResult>('/customer-financial-adjustments', payload),
  /** Voids by posting a reversal — nothing is edited or deleted. `reason` is mandatory (≥ 5 chars). */
  void: (id: string, reason: string) =>
    apiClient.post<VoidAdjustmentResult>(`/customer-financial-adjustments/${id}/void`, { reason }),

  // ── Balance transfers ─────────────────────────────────────────────────────

  /**
   * GET /customer-financial-adjustments/transfers/preview
   * Returns the source's live balance + blockers. Pass `toCustomerId` to also validate the target.
   */
  transferPreview: (fromCustomerId: string, toCustomerId?: string) =>
    apiClient.get<import('../transfer-balance').TransferPreview>(
      '/customer-financial-adjustments/transfers/preview',
      { params: { fromCustomerId, ...(toCustomerId ? { toCustomerId } : {}) } },
    ),

  /** POST /customer-financial-adjustments/transfers — posts BOTH legs atomically. */
  transfer: (payload: import('../transfer-balance').CreateBalanceTransferPayload) =>
    apiClient.post<import('../transfer-balance').TransferResult>(
      '/customer-financial-adjustments/transfers',
      payload,
    ),

  /**
   * POST /customer-financial-adjustments/transfers/:groupId/void
   * Voids BOTH legs as a group. Requires `void` + `transfer` permissions.
   * `reason` is mandatory (≥ 5 chars).
   */
  voidTransfer: (groupId: string, reason: string) =>
    apiClient.post<import('../transfer-balance').VoidTransferResult>(
      `/customer-financial-adjustments/transfers/${groupId}/void`,
      { reason },
    ),
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
