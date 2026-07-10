import { apiClient } from '@water-supply-crm/data-access';
import type { PermissionPattern } from '@water-supply-crm/authz';

/** `GET /roles` row shape — see `RoleService.list()`. */
export interface RoleSummary {
  id: string;
  vendorId: string | null;
  key: string;
  name: string;
  description: string | null;
  color: string | null;
  isSystem: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  userCount: number;
  permissionCount: number;
}

/** `GET /roles/:id` shape — see `RoleService.findOne()`. Includes the flat permission list. */
export interface RoleDetail
  extends Omit<RoleSummary, 'permissionCount'> {
  permissions: PermissionPattern[];
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  color?: string;
  /** Required by `CreateRoleDto`; the Permission Matrix (a later checkpoint) is what
   * populates this beyond `[]` — a role created here starts with no permissions. */
  permissions: PermissionPattern[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  color?: string;
  /** Omit entirely to leave the role's existing permissions untouched (`UpdateRoleDto`
   * only replaces the set when this key is present). */
  permissions?: PermissionPattern[];
}

export interface CloneRoleInput {
  name: string;
  description?: string;
}

export const rolesApi = {
  list: () => apiClient.get<RoleSummary[]>('/roles'),
  findOne: (id: string) => apiClient.get<RoleDetail>(`/roles/${id}`),
  create: (data: CreateRoleInput) => apiClient.post<RoleDetail>('/roles', data),
  update: (id: string, data: UpdateRoleInput) => apiClient.patch<RoleDetail>(`/roles/${id}`, data),
  remove: (id: string) => apiClient.delete<{ id: string; deleted: boolean }>(`/roles/${id}`),
  clone: (id: string, data: CloneRoleInput) => apiClient.post<RoleDetail>(`/roles/${id}/clone`, data),
  reset: (id: string) => apiClient.post<RoleDetail>(`/roles/${id}/reset`),
};
