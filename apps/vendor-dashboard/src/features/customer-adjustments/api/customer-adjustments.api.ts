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

export const customerAdjustmentsApi = {
  list: (params: CustomerAdjustmentQuery) =>
    apiClient.get<CustomerAdjustmentPage>('/customer-financial-adjustments', { params }),
};
