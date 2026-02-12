import { apiClient } from '@water-supply-crm/data-access';
import type { CustomerProfile } from '../../wallet/api/wallet.api';

export const profileApi = {
  getProfile: (customerId: string) =>
    apiClient.get<CustomerProfile>(`/customers/${customerId}`),
};
