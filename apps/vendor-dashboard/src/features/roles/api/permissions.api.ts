import { apiClient } from '@water-supply-crm/data-access';
import type { PermissionGroup } from '@water-supply-crm/authz';

/** `GET /permissions` — the frozen catalog, grouped exactly as `PermissionsController` returns it. */
export const permissionsApi = {
  getCatalog: () => apiClient.get<{ groups: PermissionGroup[] }>('/permissions'),
};
