import { SetMetadata } from '@nestjs/common';
import type { Permission, Resource } from '@water-supply-crm/authz';

export const PERMISSIONS_KEY = 'required_permissions';

export type PermissionMode = 'all' | 'any';

export interface RequiredPermissionsMeta {
  mode: PermissionMode;
  permissions: Permission[];
}

/** Require ALL of the given permissions (checked by PermissionsGuard). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata<string, RequiredPermissionsMeta>(PERMISSIONS_KEY, { mode: 'all', permissions });

/** Require ANY of the given permissions. */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata<string, RequiredPermissionsMeta>(PERMISSIONS_KEY, { mode: 'any', permissions });

/** Sugar for requiring a module's page permission, e.g. @RequirePage('orders'). */
export const RequirePage = (resource: Resource) =>
  SetMetadata<string, RequiredPermissionsMeta>(PERMISSIONS_KEY, {
    mode: 'all',
    permissions: [`${resource}:page` as Permission],
  });
