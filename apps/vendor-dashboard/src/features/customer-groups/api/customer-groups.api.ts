import { apiClient } from '@water-supply-crm/data-access';

export interface CustomerSubGroup {
  id: string;
  name: string;
  parentId: string | null;
  deletedAt: string | null;
  customerCount: number;
}

export interface CustomerGroupNode {
  id: string;
  name: string;
  deletedAt: string | null;
  customerCount: number;
  subGroups: CustomerSubGroup[];
}

export const customerGroupsApi = {
  getSettings: () => apiClient.get<{ enabled: boolean }>('/customer-groups/settings'),
  setSettings: (enabled: boolean) => apiClient.put<{ enabled: boolean }>('/customer-groups/settings', { enabled }),
  // Super admin: any vendor
  getVendorSettings: (vendorId: string) => apiClient.get<{ enabled: boolean }>(`/vendors/${vendorId}/customer-grouping`),
  setVendorSettings: (vendorId: string, enabled: boolean) =>
    apiClient.put<{ enabled: boolean }>(`/vendors/${vendorId}/customer-grouping`, { enabled }),
  list: (includeDeleted = false) =>
    apiClient.get<CustomerGroupNode[]>('/customer-groups', { params: includeDeleted ? { includeDeleted: true } : undefined }),
  create: (data: { name: string; parentId?: string }) => apiClient.post('/customer-groups', data),
  rename: (id: string, name: string) => apiClient.patch(`/customer-groups/${id}`, { name }),
  remove: (id: string) => apiClient.delete(`/customer-groups/${id}`),
  bulkAssign: (data: { customerIds: string[]; groupId: string | null; subGroupId: string | null }) =>
    apiClient.post<{ updated: number }>('/customers/bulk-assign-group', data),
};
