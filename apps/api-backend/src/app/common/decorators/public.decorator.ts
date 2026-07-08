import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'is_public_route';

/**
 * Marks a route as public — skips the PermissionsGuard requirement entirely.
 * Used for unauthenticated endpoints (login, password reset) when the guard chain
 * becomes global in Phase C. Has no effect on routes that don't use PermissionsGuard.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
