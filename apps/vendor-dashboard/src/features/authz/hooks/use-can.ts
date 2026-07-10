import type { Permission } from '@water-supply-crm/authz';
import { usePermissions } from './use-permissions';

/** `true` if the current user holds `permission`. Thin boolean wrapper over `usePermissions()`. */
export function useCan(permission: Permission): boolean {
  return usePermissions().can(permission);
}

/** `true` if the current user holds any of `permissions`. */
export function useCanAny(permissions: readonly Permission[]): boolean {
  return usePermissions().canAny(permissions);
}

/** `true` if the current user holds all of `permissions`. */
export function useCanAll(permissions: readonly Permission[]): boolean {
  return usePermissions().canAll(permissions);
}
