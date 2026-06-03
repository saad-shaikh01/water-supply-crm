export type BillingType = 'MONTHLY' | 'CASH';
export type BulkPriceActionType = 'SET' | 'FLAT_INCREASE' | 'PERCENTAGE_INCREASE';

export interface BulkPriceFilters {
  productId: string;
  priceFrom?: number;
  priceTo?: number;
  area?: string;
  vanId?: string;
  billingType?: BillingType;
}

export interface BulkPriceAction {
  type: BulkPriceActionType;
  value: number;
}

export type BulkPricePreviewRequest = BulkPriceFilters;

export interface BulkPriceUpdateRequest {
  filters: BulkPriceFilters;
  action: BulkPriceAction;
}

export interface PricingCustomerRow {
  id: string;
  name: string;
  area: string;
  currentPrice: number;
}

export interface BulkPricePreviewResponse {
  count: number;
  customers: PricingCustomerRow[];
}

export interface BulkPriceUpdateResponse {
  updatedCount: number;
}

export type BulkUpdateJobState = 'waiting' | 'active' | 'completed' | 'failed';

export interface BulkUpdateEnqueueResponse {
  jobId: string;
  totalCustomers: number;
}

export interface BulkUpdateJobStatus {
  jobId: string;
  state: BulkUpdateJobState;
  progress: number;
  totalCustomers: number;
  updatedCount: number;
}
