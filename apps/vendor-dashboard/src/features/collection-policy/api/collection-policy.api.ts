import { apiClient } from '@water-supply-crm/data-access';
import type { CollectionPolicy, CashCollectionPolicy, CashCollectionPolicyImpact } from '@water-supply-crm/types';

export const collectionPolicyApi = {
  get: () => apiClient.get<CollectionPolicy>('/collection-policy'),
  update: (payload: CollectionPolicy) =>
    apiClient.patch<CollectionPolicy>('/collection-policy', payload),
};

export interface CashCollectionPolicyImpactParams {
  allowedCreditDeliveries: number;
  minExposureFloor: number;
  maxOutstandingCeiling?: number;
}

export const cashCollectionPolicyApi = {
  get: () => apiClient.get<CashCollectionPolicy>('/collection-policy/cash'),
  update: (payload: CashCollectionPolicy) =>
    apiClient.patch<CashCollectionPolicy>('/collection-policy/cash', payload),
  impact: (params: CashCollectionPolicyImpactParams) =>
    apiClient.get<CashCollectionPolicyImpact>('/collection-policy/cash/impact', { params }),
};
