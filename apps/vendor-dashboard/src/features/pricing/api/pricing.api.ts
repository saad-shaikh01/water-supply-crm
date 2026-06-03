import { apiClient } from '@water-supply-crm/data-access';
import type {
  BulkPricePreviewRequest,
  BulkPriceUpdateRequest,
  BulkPricePreviewResponse,
  BulkUpdateEnqueueResponse,
  BulkUpdateJobStatus,
} from '../types';

export const pricingApi = {
  previewBulkPricing: (data: BulkPricePreviewRequest) =>
    apiClient.post<BulkPricePreviewResponse>('/customers/pricing/preview', data),

  bulkUpdatePricing: (data: BulkPriceUpdateRequest) =>
    apiClient.post<BulkUpdateEnqueueResponse>('/customers/pricing/bulk-update', data),

  getBulkUpdateStatus: (jobId: string) =>
    apiClient.get<BulkUpdateJobStatus>(`/customers/pricing/bulk-update/${jobId}/status`),
};
