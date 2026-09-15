import { apiClient } from '@water-supply-crm/data-access';

/**
 * Historical Product Cost & COGS (docs/features/product-cost-history-and-cogs.md
 * §7). Thin fetch wrappers over the `/product-costs` endpoints — mirrors
 * `fuel-card.api.ts`'s shape (typed payloads/responses, no logic here).
 */

export type ProductCostSource = 'MANUAL';

export interface ProductCost {
  id: string;
  vendorId: string;
  productId: string;
  costPerUnit: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  invoiceRef: string | null;
  source: ProductCostSource;
  createdById: string;
  createdAt: string;
  voidedAt: string | null;
  voidedById: string | null;
  voidReason: string | null;
  /** Computed server-side (2026-09-15 polish, design doc §4.4/§7.3) — true
   *  iff this row is currently eligible for Controlled Edit (zero non-voided
   *  deliveries in its effective range; always false once voided). Live,
   *  request-time computation, not cached — a row can flip back to editable
   *  if the deliveries that disqualified it are later voided. Use this to
   *  hide the Edit action proactively instead of discovering ineligibility
   *  only from a 409 on submit. */
  isEditable: boolean;
}

export interface CreateProductCostPayload {
  productId: string;
  costPerUnit: number;
  /** ISO date string, e.g. `2026-01-15`. */
  effectiveFrom: string;
  /** Optional for a plain forward-dated new rate; the backend rejects a
   *  backdated insert that trims an existing row when this is missing. */
  note?: string;
  invoiceRef?: string;
}

export interface EditProductCostPayload {
  costPerUnit: number;
  /** Mandatory reason for the correction — always required by the backend. */
  note: string;
}

export interface VoidProductCostPayload {
  voidReason: string;
}

export const productCostsApi = {
  listHistory: (productId: string) => apiClient.get<ProductCost[]>(`/product-costs/product/${productId}`),
  create: (data: CreateProductCostPayload) => apiClient.post<ProductCost>('/product-costs', data),
  edit: (id: string, data: EditProductCostPayload) => apiClient.patch<ProductCost>(`/product-costs/${id}`, data),
  voidRow: (id: string, data: VoidProductCostPayload) => apiClient.post<ProductCost>(`/product-costs/${id}/void`, data),
};
