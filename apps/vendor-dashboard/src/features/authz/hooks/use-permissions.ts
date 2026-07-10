import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCookie } from 'cookies-next';
import {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  pagePermissionForPath,
  type Permission,
} from '@water-supply-crm/authz';
import { authApi, type AuthProfile } from '../../auth/api/auth.api';
import { queryKeys } from '../../../lib/query-keys';

/**
 * Bootstraps the current user's effective permissions from `GET /auth/me`. This is the
 * first place in the app that fetches `/auth/me` — everything else (identity, role)
 * previously relied solely on the persisted `useAuthStore`, which never refreshes.
 * Kept short-lived (`staleTime` well below the query client's 5-minute default) since
 * permission edits made by an admin elsewhere should be picked up promptly.
 */
export function usePermissionsQuery() {
  return useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => authApi.me().then((r) => r.data),
    enabled: !!getCookie('auth_token'),
    staleTime: 60_000,
  });
}

export interface UsePermissionsResult {
  /** Raw effective permission set from the server (already wildcard-expanded). */
  permissions: Permission[];
  /** True while the initial `/auth/me` fetch is in flight (no permission data yet). */
  isLoading: boolean;
  /** SUPER_ADMIN holds every permission; surfaced for UI/badging, not required by `can()`. */
  isSuperAdmin: boolean;
  can: (permission: Permission) => boolean;
  canAny: (permissions: readonly Permission[]) => boolean;
  canAll: (permissions: readonly Permission[]) => boolean;
  /** Resolves a pathname to its `:page` permission via the shared Page Registry and checks it. */
  canAccessPage: (pathname: string) => boolean;
  /** Force a fresh `/auth/me` fetch — call after saving a role/override that may affect the caller. */
  refetch: () => void;
}

/**
 * The single source of truth for Layer 1–3 authorization checks in the vendor dashboard.
 * Wraps `@water-supply-crm/authz`'s wildcard-aware matcher — never reimplement the check here.
 */
export function usePermissions(): UsePermissionsResult {
  const { data, isLoading, refetch } = usePermissionsQuery();

  const permissionSet = useMemo(() => new Set<Permission>(data?.permissions ?? []), [data]);
  const isSuperAdmin = data?.role === 'SUPER_ADMIN';

  return {
    permissions: data?.permissions ?? [],
    isLoading,
    isSuperAdmin,
    can: (permission) => hasPermission(permissionSet, permission),
    canAny: (permissions) => hasAnyPermission(permissionSet, permissions),
    canAll: (permissions) => hasAllPermissions(permissionSet, permissions),
    canAccessPage: (pathname) => {
      const permission = pagePermissionForPath(pathname);
      return permission ? hasPermission(permissionSet, permission) : false;
    },
    refetch: () => void refetch(),
  };
}

/** Invalidate `/auth/me` from anywhere (e.g. after a role/override save) to force a refresh. */
export function useInvalidatePermissions() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
}

export type { AuthProfile };
