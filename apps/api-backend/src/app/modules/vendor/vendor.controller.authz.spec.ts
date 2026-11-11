import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { REQUIRE_ROLE_KEY } from '../../common/decorators/authz-markers.decorator';
import { VendorController } from './vendor.controller';
import { AuthController } from '../auth/auth.controller';

const guard = () => new PermissionsGuard(new Reflector(), { getEffectivePermissions: async () => [] } as never);

const ctx = (handler: string, user: unknown) =>
  ({
    getHandler: () => (VendorController.prototype as any)[handler],
    getClass: () => VendorController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const handlers = (proto: object) =>
  Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor' && typeof (proto as any)[n] === 'function');

describe('VendorController authorization', () => {
  it('has class-level SUPER_ADMIN-only metadata', () => {
    expect(Reflect.getMetadata(REQUIRE_ROLE_KEY, VendorController)).toEqual(['SUPER_ADMIN']);
  });

  it('has no @Public handler', () => {
    for (const h of handlers(VendorController.prototype)) {
      expect(Reflect.getMetadata(PUBLIC_KEY, (VendorController.prototype as any)[h])).toBeFalsy();
    }
  });

  const mutating = ['create', 'suspend', 'unsuspend', 'remove', 'provision'];

  it.each(mutating)('%s admits SUPER_ADMIN', async (h) => {
    await expect(guard().canActivate(ctx(h, { userId: 's', role: 'SUPER_ADMIN' }))).resolves.toBe(true);
  });

  it.each(mutating)('%s rejects non-SUPER_ADMIN roles with 403', async (h) => {
    for (const role of ['VENDOR_ADMIN', 'DRIVER', 'CUSTOMER']) {
      await expect(guard().canActivate(ctx(h, { userId: 'u', role, vendorId: 'v1' }))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it.each(mutating)('%s rejects anonymous with 401', async (h) => {
    await expect(guard().canActivate(ctx(h, undefined))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthController exposes no signup/register route', () => {
  it('has exactly login, me, forgot-password, reset-password, refresh, logout', () => {
    const paths = handlers(AuthController.prototype)
      .map((h) => Reflect.getMetadata('path', (AuthController.prototype as any)[h]))
      .filter((p) => p !== undefined)
      .sort();
    expect(paths).toEqual(['forgot-password', 'login', 'logout', 'me', 'refresh', 'reset-password']);
  });
});
