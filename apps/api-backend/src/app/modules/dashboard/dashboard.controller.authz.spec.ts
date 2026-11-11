import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { REQUIRE_ROLE_KEY } from '../../common/decorators/authz-markers.decorator';
import { DashboardController } from './dashboard.controller';

const guardWith = (perms: string[] = []) =>
  new PermissionsGuard(new Reflector(), { getEffectivePermissions: async () => perms } as never);

const ctx = (handler: string, user: unknown) =>
  ({
    getHandler: () => (DashboardController.prototype as any)[handler],
    getClass: () => DashboardController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const as = (role: string) => ({ userId: 'u1', role, vendorId: role === 'SUPER_ADMIN' ? null : 'v1' });

describe('GET /dashboard/platform authorization', () => {
  it('is marked SUPER_ADMIN only', () => {
    expect(Reflect.getMetadata(REQUIRE_ROLE_KEY, DashboardController.prototype.getPlatformOverview)).toEqual(['SUPER_ADMIN']);
  });

  it('admits SUPER_ADMIN', async () => {
    await expect(guardWith().canActivate(ctx('getPlatformOverview', as('SUPER_ADMIN')))).resolves.toBe(true);
  });

  it.each(['VENDOR_ADMIN', 'DRIVER', 'CUSTOMER'])('rejects %s with 403', async (role) => {
    await expect(guardWith(['dashboard:view']).canActivate(ctx('getPlatformOverview', as(role)))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects anonymous with 401', async () => {
    await expect(guardWith().canActivate(ctx('getPlatformOverview', undefined))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('GET /dashboard/overview is vendor-scoped (why the admin panel must not call it)', () => {
  it('SUPER_ADMIN without dashboard:view permission is refused', async () => {
    await expect(guardWith([]).canActivate(ctx('getOverview', as('SUPER_ADMIN')))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a holder of dashboard:view is admitted', async () => {
    await expect(guardWith(['dashboard:view']).canActivate(ctx('getOverview', as('VENDOR_ADMIN')))).resolves.toBe(true);
  });
});
