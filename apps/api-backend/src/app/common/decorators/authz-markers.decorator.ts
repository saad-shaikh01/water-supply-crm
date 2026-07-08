import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

/**
 * Authorization markers for domains outside the vendor permission catalog, all handled
 * by the single PermissionsGuard so the guard can enforce deny-by-default globally.
 */

/** Any authenticated user may access (self-service endpoints — no specific permission). */
export const AUTHENTICATED_ONLY_KEY = 'authenticated_only';
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY_KEY, true);

/**
 * Requires the caller to hold one of the given legacy UserRoles — for the platform
 * (super-admin) and customer-portal surfaces, which are intentionally outside the vendor
 * permission catalog. Multi-role like the legacy RolesGuard.
 */
export const REQUIRE_ROLE_KEY = 'require_user_roles';
export const RequireRoles = (...roles: UserRole[]) => SetMetadata(REQUIRE_ROLE_KEY, roles);

/** Platform surface — super-admin only. */
export const RequireSuperAdmin = () => RequireRoles(UserRole.SUPER_ADMIN);

/** Customer-portal surface — customer identity only. */
export const RequireCustomer = () => RequireRoles(UserRole.CUSTOMER);
