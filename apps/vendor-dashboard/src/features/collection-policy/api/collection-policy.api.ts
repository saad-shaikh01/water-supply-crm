import { apiClient } from '@water-supply-crm/data-access';
import type { CollectionPolicy } from '@water-supply-crm/types';

export const collectionPolicyApi = {
  get: () => apiClient.get<CollectionPolicy>('/collection-policy'),
  update: (payload: CollectionPolicy) =>
    apiClient.patch<CollectionPolicy>('/collection-policy', payload),
};
