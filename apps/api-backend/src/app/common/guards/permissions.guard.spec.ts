import { PermissionsGuard } from './permissions.guard';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { AUTHENTICATED_ONLY_KEY, REQUIRE_ROLE_KEY } from '../decorators/authz-markers.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

function ctx(user: unknown) {
  return {
    getHandler: () => 'h',
    getClass: () => 'c',
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

/** Reflector stub driven by a metadata map keyed by the SetMetadata key. */
function reflector(meta: Record<string, unknown>) {
  return { getAllAndOverride: (key: string) => meta[key] } as never;
}

function guard(meta: Record<string, unknown>, effective: string[] = []) {
  const permissionService = {
    getEffectivePermissions: jest.fn(async () => effective),
  } as never;
  return new PermissionsGuard(reflector(meta), permissionService);
}

const authedUser = { userId: 'u1', role: 'VENDOR_ADMIN' };

describe('PermissionsGuard decision table', () => {
  it('@Public → allow (even without a user)', async () => {
    await expect(guard({ [PUBLIC_KEY]: true }).canActivate(ctx(undefined))).resolves.toBe(true);
  });

  it('@AuthenticatedOnly → allow authenticated, reject anonymous', async () => {
    await expect(guard({ [AUTHENTICATED_ONLY_KEY]: true }).canActivate(ctx(authedUser))).resolves.toBe(true);
    await expect(guard({ [AUTHENTICATED_ONLY_KEY]: true }).canActivate(ctx(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('@RequireRoles → allow any listed role, reject others', async () => {
    await expect(
      guard({ [REQUIRE_ROLE_KEY]: ['SUPER_ADMIN'] }).canActivate(ctx({ userId: 's', role: 'SUPER_ADMIN' })),
    ).resolves.toBe(true);
    await expect(
      guard({ [REQUIRE_ROLE_KEY]: ['SUPER_ADMIN'] }).canActivate(ctx(authedUser)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // multi-role (e.g. vendor GET /:id → SUPER_ADMIN or VENDOR_ADMIN)
    await expect(
      guard({ [REQUIRE_ROLE_KEY]: ['SUPER_ADMIN', 'VENDOR_ADMIN'] }).canActivate(ctx(authedUser)),
    ).resolves.toBe(true);
    await expect(
      guard({ [REQUIRE_ROLE_KEY]: ['CUSTOMER'] }).canActivate(ctx(authedUser)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('@RequirePermissions (all) → granted only with every permission', async () => {
    const meta = { [PERMISSIONS_KEY]: { mode: 'all', permissions: ['customers:view', 'customers:update'] } };
    await expect(guard(meta, ['customers:view', 'customers:update']).canActivate(ctx(authedUser))).resolves.toBe(true);
    await expect(guard(meta, ['customers:view']).canActivate(ctx(authedUser))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('@RequireAnyPermission (any) → granted with at least one', async () => {
    const meta = { [PERMISSIONS_KEY]: { mode: 'any', permissions: ['orders:approve', 'orders:reject'] } };
    await expect(guard(meta, ['orders:reject']).canActivate(ctx(authedUser))).resolves.toBe(true);
    await expect(guard(meta, ['orders:view']).canActivate(ctx(authedUser))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('wildcard effective set satisfies any permission check', async () => {
    const meta = { [PERMISSIONS_KEY]: { mode: 'all', permissions: ['audit_logs:view'] } };
    await expect(guard(meta, ['*']).canActivate(ctx(authedUser))).resolves.toBe(true);
  });

  it('DENY BY DEFAULT: no marker → ForbiddenException', async () => {
    await expect(guard({}).canActivate(ctx(authedUser))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
