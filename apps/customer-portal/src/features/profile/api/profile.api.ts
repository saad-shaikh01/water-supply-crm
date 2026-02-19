import { apiClient } from '@water-supply-crm/data-access';
import type { PortalProfile } from '../../wallet/api/wallet.api';

export const profileApi = {
  getProfile: (customerId: string) =>
    apiClient.get<PortalProfile>(`/customers/${customerId}`),
};
