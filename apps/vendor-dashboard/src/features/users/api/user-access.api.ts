import { apiClient } from '@water-supply-crm/data-access';
import type { PermissionPattern } from '@water-supply-crm/authz';

export interface UserRoleRef {
  id: string;
  key: string;
  name: string;
}

export interface UserAccessOverride {
  permission: PermissionPattern;
  effect: 'ALLOW' | 'DENY';
  expiresAt: string | null;
}

/** `GET /users/:id/permissions` shape — see `UserPermissionService.getEffective()`. */
export interface UserEffectiveAccess {
  userId: string;
  role: UserRoleRef | null;
  overrides: UserAccessOverride[];
  permissions: PermissionPattern[];
  pagePermissions: PermissionPattern[];
}

export interface OverrideInput {
  permission: PermissionPattern;
  effect: 'ALLOW' | 'DENY';
  /** Omit for a permanent override; ISO date string for a temporary one. */
  expiresAt?: string;
}

export const userAccessApi = {
  getEffective: (userId: string) =>
    apiClient.get<UserEffectiveAccess>(`/users/${userId}/permissions`),
  assignRole: (userId: string, roleId: string) =>
    apiClient.patch<{ userId: string; roleId: string; roleName: string }>(
      `/users/${userId}/role`,
      { roleId },
    ),
  /** Full replacement of the user's overrides — mirrors `UpdateOverridesDto`. */
  setOverrides: (userId: string, overrides: OverrideInput[]) =>
    apiClient.patch<UserEffectiveAccess>(`/users/${userId}/overrides`, { overrides }),
};
