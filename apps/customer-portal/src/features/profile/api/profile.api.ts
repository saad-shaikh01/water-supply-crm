import { apiClient } from '@water-supply-crm/data-access';
import type { PortalProfile } from '../../wallet/api/wallet.api';

export const profileApi = {
  getProfile: () =>
    apiClient.get<PortalProfile>('/portal/me'),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    apiClient.post('/portal/change-password', data),
};
