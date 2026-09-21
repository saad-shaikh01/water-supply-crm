import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { CustomerFinancialAdjustmentController } from './customer-financial-adjustment.controller';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Route-level gating: the REAL PermissionsGuard evaluated against the REAL metadata on
 * the controller's handler. (The exact per-kind check lives in the service and is
 * covered by the service spec; this proves the coarse route guard is in place and that
 * the app's deny-by-default guard would not let an unrelated permission through.)
 */
function contextFor(user: unknown) {
  return {
    getHandler: () => CustomerFinancialAdjustmentController.prototype.create,
    getClass: () => CustomerFinancialAdjustmentController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

function guardFor(effective: string[]) {
  const permissionService = { getEffectivePermissions: jest.fn(async () => effective) } as never;
  return new PermissionsGuard(new Reflector(), permissionService);
}

const P = (a: string) => `customer_financial_adjustments:${a}`;
const USER = { userId: 'u1', role: 'STAFF', vendorId: 'v1' };

describe('CustomerFinancialAdjustmentController — POST /customer-financial-adjustments', () => {
  it('is guarded by "any of" the three posting tiers (charges, credits, restricted)', () => {
    const meta = Reflect.getMetadata(PERMISSIONS_KEY, CustomerFinancialAdjustmentController.prototype.create);
    expect(meta).toEqual({
      mode: 'any',
      permissions: [P('create'), P('create_credit'), P('create_restricted')],
    });
  });

  it.each([[P('create')], [P('create_credit')], [P('create_restricted')], [P('create'), P('create_credit')]])(
    'lets a holder of %s through the route guard',
    async (...perms) => {
      await expect(guardFor(perms).canActivate(contextFor(USER))).resolves.toBe(true);
    },
  );

  it('the wildcard grant (Vendor Admin) passes', async () => {
    await expect(guardFor(['*']).canActivate(contextFor(USER))).resolves.toBe(true);
  });

  it.each([
    [[P('view')]],
    [[P('void')]],
    [[P('transfer')]],
    [['transactions:adjust']], // the LEGACY manual-adjustment permission grants nothing here
    [['customers:view', 'customers:update']],
    [[]],
  ])('refuses a user holding only %p', async (perms) => {
    await expect(guardFor(perms).canActivate(contextFor(USER))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an unauthenticated request', async () => {
    await expect(guardFor([P('create')]).canActivate(contextFor(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('delegates to the service with the authenticated user and the body', async () => {
    const service = { create: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new CustomerFinancialAdjustmentController(service as never);
    const user = { userId: 'u1', vendorId: 'v1' } as AuthUser;
    const body = { customerId: 'c1' } as never;

    await expect(controller.create(user, body)).resolves.toEqual({ ok: true });
    expect(service.create).toHaveBeenCalledWith(user, body);
  });
});

describe('CustomerFinancialAdjustmentController — POST /customer-financial-adjustments/:id/void', () => {
  const voidContext = (user: unknown) =>
    ({
      getHandler: () => CustomerFinancialAdjustmentController.prototype.voidAdjustment,
      getClass: () => CustomerFinancialAdjustmentController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as never;

  it('is guarded by the static `void` permission (ALL-of, one permission)', () => {
    const meta = Reflect.getMetadata(PERMISSIONS_KEY, CustomerFinancialAdjustmentController.prototype.voidAdjustment);
    expect(meta).toEqual({ mode: 'all', permissions: [P('void')] });
  });

  it('lets a holder of `void` (or the wildcard) through', async () => {
    await expect(guardFor([P('void')]).canActivate(voidContext(USER))).resolves.toBe(true);
    await expect(guardFor(['*']).canActivate(voidContext(USER))).resolves.toBe(true);
  });

  it.each([
    [[P('create')]],
    [[P('create_credit')]],
    [[P('transfer')]],
    [[P('create_restricted')]],
    [[P('view')]],
    [['transactions:adjust']], // the legacy permission grants nothing here
    [[]],
  ])('refuses a user holding only %p', async (perms) => {
    await expect(guardFor(perms).canActivate(voidContext(USER))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an unauthenticated request', async () => {
    await expect(guardFor([P('void')]).canActivate(voidContext(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('the void route does not open the create route, and vice versa', async () => {
    // A poster who cannot void, and a voider who cannot post, are both real roles.
    await expect(guardFor([P('void')]).canActivate(contextFor(USER))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guardFor([P('create')]).canActivate(voidContext(USER))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('delegates to the service with the user, the :id and the body', async () => {
    const service = { voidAdjustment: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new CustomerFinancialAdjustmentController(service as never);
    const user = { userId: 'u1', vendorId: 'v1' } as AuthUser;
    const body = { reason: 'Entered against the wrong customer' } as never;

    await expect(controller.voidAdjustment(user, 'adj-1', body)).resolves.toEqual({ ok: true });
    expect(service.voidAdjustment).toHaveBeenCalledWith(user, 'adj-1', body);
  });
});

describe('CustomerFinancialAdjustmentController — GET reads (list / get)', () => {
  const readContext = (handler: unknown, user: unknown) =>
    ({
      getHandler: () => handler,
      getClass: () => CustomerFinancialAdjustmentController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as never;
  const proto = CustomerFinancialAdjustmentController.prototype;

  it.each([
    ['list', proto.list],
    ['get', proto.get],
  ])('%s is guarded by the static `view` permission', (_name, handler) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({ mode: 'all', permissions: [P('view')] });
  });

  it.each([
    ['list', proto.list],
    ['get', proto.get],
  ])('%s: lets a holder of `view` (or the wildcard) through', async (_name, handler) => {
    await expect(guardFor([P('view')]).canActivate(readContext(handler, USER))).resolves.toBe(true);
    await expect(guardFor(['*']).canActivate(readContext(handler, USER))).resolves.toBe(true);
  });

  it.each([
    ['list', proto.list],
    ['get', proto.get],
  ])('%s: refuses every other adjustment permission, customers:view and the legacy transactions:view', async (_name, handler) => {
    // A poster / voider / transferrer who is not ALSO granted `view` cannot read the documents.
    for (const perms of [
      [P('create')], [P('create_credit')], [P('create_restricted')], [P('transfer')], [P('void')],
      ['customers:view'], ['transactions:view'], [],
    ]) {
      await expect(guardFor(perms).canActivate(readContext(handler, USER))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it.each([
    ['list', proto.list],
    ['get', proto.get],
  ])('%s: refuses an unauthenticated request', async (_name, handler) => {
    await expect(guardFor([P('view')]).canActivate(readContext(handler, undefined))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('`view` alone does not open any write route', async () => {
    await expect(guardFor([P('view')]).canActivate(contextFor(USER))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guardFor([P('view')]).canActivate(readContext(proto.voidAdjustment, USER)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('delegates list/get with the CALLER\'S vendor (never a client-supplied one)', async () => {
    const service = {
      list: jest.fn().mockResolvedValue({ data: [] }),
      get: jest.fn().mockResolvedValue({ id: 'adj-1' }),
    };
    const controller = new CustomerFinancialAdjustmentController(service as never);
    const user = { userId: 'u1', vendorId: 'vendor-of-caller' } as AuthUser;
    const query = { customerId: 'c1', page: 2 } as never;

    await expect(controller.list(user, query)).resolves.toEqual({ data: [] });
    expect(service.list).toHaveBeenCalledWith('vendor-of-caller', query);
    await expect(controller.get(user, 'adj-1')).resolves.toEqual({ id: 'adj-1' });
    expect(service.get).toHaveBeenCalledWith('vendor-of-caller', 'adj-1');
  });
});
