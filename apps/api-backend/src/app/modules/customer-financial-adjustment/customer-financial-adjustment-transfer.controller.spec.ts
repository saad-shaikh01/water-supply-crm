import 'reflect-metadata';
import { ForbiddenException, RequestMethod, UnauthorizedException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser } from '@water-supply-crm/types';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { CustomerFinancialAdjustmentController } from './customer-financial-adjustment.controller';
import { CustomerFinancialAdjustmentModule } from './customer-financial-adjustment.module';
import { CustomerFinancialAdjustmentTransferController } from './customer-financial-adjustment-transfer.controller';
import { CreateBalanceTransferDto } from './dto/create-balance-transfer.dto';
import { TransferPreviewQueryDto } from './dto/transfer-preview-query.dto';

/**
 * Route-level gating for the transfer endpoints: the REAL PermissionsGuard evaluated against
 * the REAL metadata on each handler, plus the wiring that keeps `transfers/...` from being
 * shadowed by the main controller's dynamic `:id` routes, plus the request DTOs under the same
 * `whitelist + forbidNonWhitelisted` rules as the app's global ValidationPipe. (The
 * authoritative business checks are in the service spec.)
 */
const Controller = CustomerFinancialAdjustmentTransferController;
const P = (a: string) => `customer_financial_adjustments:${a}`;
const USER = { userId: 'u1', role: 'STAFF', vendorId: 'v1' };

const contextFor = (handler: unknown, user: unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as never;

const guardFor = (effective: string[]) =>
  new PermissionsGuard(new Reflector(), { getEffectivePermissions: jest.fn(async () => effective) } as never);

const proto = Controller.prototype;
const UUID_A = '3f0c1d7e-5c1a-4a52-9d1e-0a7b2a8f0001';
const UUID_B = '3f0c1d7e-5c1a-4a52-9d1e-0a7b2a8f0002';

describe('CustomerFinancialAdjustmentTransferController — wiring', () => {
  it('lives under the adjustments prefix, with the three routes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, Controller)).toBe('customer-financial-adjustments/transfers');
    expect([proto.preview, proto.create, proto.voidTransfer].map((h) => Reflect.getMetadata(PATH_METADATA, h))).toEqual([
      'preview',
      '/',
      ':groupId/void',
    ]);
    expect([proto.preview, proto.create, proto.voidTransfer].map((h) => Reflect.getMetadata(METHOD_METADATA, h))).toEqual([
      RequestMethod.GET,
      RequestMethod.POST,
      RequestMethod.POST,
    ]);
  });

  it('is registered BEFORE the main controller so `transfers/...` is never shadowed by its dynamic `:id`', () => {
    const controllers: unknown[] = Reflect.getMetadata('controllers', CustomerFinancialAdjustmentModule);
    expect(controllers.indexOf(Controller)).toBeGreaterThanOrEqual(0);
    expect(controllers.indexOf(Controller)).toBeLessThan(controllers.indexOf(CustomerFinancialAdjustmentController));
  });

  it('registers the transfer service as a provider', () => {
    const providers: { name: string }[] = Reflect.getMetadata('providers', CustomerFinancialAdjustmentModule);
    expect(providers.map((p) => p.name)).toContain('CustomerFinancialAdjustmentTransferService');
  });
});

describe('CustomerFinancialAdjustmentTransferController — permissions', () => {
  it('preview and create each require `transfer`; void requires BOTH `void` and `transfer` (ALL-of)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.preview)).toEqual({ mode: 'all', permissions: [P('transfer')] });
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.create)).toEqual({ mode: 'all', permissions: [P('transfer')] });
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.voidTransfer)).toEqual({
      mode: 'all',
      permissions: [P('void'), P('transfer')],
    });
  });

  it.each([['preview'], ['create']] as const)('%s: a `transfer` holder (or the wildcard) passes', async (handler) => {
    await expect(guardFor([P('transfer')]).canActivate(contextFor(proto[handler], USER))).resolves.toBe(true);
    await expect(guardFor(['*']).canActivate(contextFor(proto[handler], USER))).resolves.toBe(true);
  });

  it.each([['preview'], ['create']] as const)('%s: refuses every other adjustment permission and the legacy one', async (handler) => {
    for (const perms of [
      [P('view')],
      [P('create')],
      [P('create_credit')],
      [P('create_restricted')],
      [P('void')],
      ['transactions:adjust'],
      ['customers:view', 'customers:update'],
      [],
    ]) {
      await expect(guardFor(perms).canActivate(contextFor(proto[handler], USER))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('void: passes with both, the wildcard; refused with only one of them', async () => {
    const ctx = contextFor(proto.voidTransfer, USER);
    await expect(guardFor([P('void'), P('transfer')]).canActivate(ctx)).resolves.toBe(true);
    await expect(guardFor(['*']).canActivate(ctx)).resolves.toBe(true);
    for (const perms of [[P('void')], [P('transfer')], [P('view')], [P('create')], []]) {
      await expect(guardFor(perms).canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('refuses an unauthenticated request on every route', async () => {
    for (const handler of [proto.preview, proto.create, proto.voidTransfer]) {
      await expect(guardFor(['*']).canActivate(contextFor(handler, undefined))).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('a transfer permission does not open the single-adjustment routes, and vice versa', async () => {
    const mainCreate = {
      getHandler: () => CustomerFinancialAdjustmentController.prototype.create,
      getClass: () => CustomerFinancialAdjustmentController,
      switchToHttp: () => ({ getRequest: () => ({ user: USER }) }),
    } as never;
    await expect(guardFor([P('transfer')]).canActivate(mainCreate)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guardFor([P('create')]).canActivate(contextFor(proto.create, USER))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('CustomerFinancialAdjustmentTransferController — delegation', () => {
  const user = { userId: 'u1', vendorId: 'v1' } as AuthUser;

  it('preview scopes to the CALLER’s vendor (never a client-supplied one)', async () => {
    const service = { preview: jest.fn().mockResolvedValue({ ok: 1 }) };
    const query = { fromCustomerId: UUID_A } as never;
    await expect(new Controller(service as never).preview(user, query)).resolves.toEqual({ ok: 1 });
    expect(service.preview).toHaveBeenCalledWith('v1', query);
  });

  it('create and void pass the authenticated user, the body and the :groupId', async () => {
    const service = { create: jest.fn().mockResolvedValue({ ok: 2 }), voidTransfer: jest.fn().mockResolvedValue({ ok: 3 }) };
    const controller = new Controller(service as never);
    const body = { amount: 1 } as never;
    const reason = { reason: 'Wrong account' } as never;

    await expect(controller.create(user, body)).resolves.toEqual({ ok: 2 });
    expect(service.create).toHaveBeenCalledWith(user, body);
    await expect(controller.voidTransfer(user, 'grp-1', reason)).resolves.toEqual({ ok: 3 });
    expect(service.voidTransfer).toHaveBeenCalledWith(user, 'grp-1', reason);
  });
});

/** Same rules as the app's global ValidationPipe: whitelist + forbidNonWhitelisted. */
async function check<T extends object>(cls: new () => T, body: Record<string, unknown>) {
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, fields: errors.map((e) => e.property).sort() };
}

describe('CreateBalanceTransferDto', () => {
  const valid = { fromCustomerId: UUID_A, toCustomerId: UUID_B, amount: 250.5, idempotencyKey: 'transfer-key-0001' };

  it('accepts a minimal body and one with the optional staff fields', async () => {
    expect((await check(CreateBalanceTransferDto, valid)).fields).toEqual([]);
    expect((await check(CreateBalanceTransferDto, { ...valid, internalNote: 'Moved shops', referenceNo: 'REF-1' })).fields).toEqual([]);
  });

  it('requires both customers as UUIDs, an amount and a key', async () => {
    expect((await check(CreateBalanceTransferDto, {})).fields).toEqual(['amount', 'fromCustomerId', 'idempotencyKey', 'toCustomerId']);
    expect((await check(CreateBalanceTransferDto, { ...valid, fromCustomerId: 'not-a-uuid' })).fields).toEqual(['fromCustomerId']);
    expect((await check(CreateBalanceTransferDto, { ...valid, toCustomerId: 'not-a-uuid' })).fields).toEqual(['toCustomerId']);
  });

  it.each([[0], [-1], [0.001], [10.005], ['100'], [null]])('rejects amount %p', async (amount) => {
    expect((await check(CreateBalanceTransferDto, { ...valid, amount })).fields).toEqual(['amount']);
  });

  it('requires an idempotency key of 8–100 characters (after trimming)', async () => {
    expect((await check(CreateBalanceTransferDto, { ...valid, idempotencyKey: 'short' })).fields).toEqual(['idempotencyKey']);
    expect((await check(CreateBalanceTransferDto, { ...valid, idempotencyKey: '  short  ' })).fields).toEqual(['idempotencyKey']);
    expect((await check(CreateBalanceTransferDto, { ...valid, idempotencyKey: 'x'.repeat(101) })).fields).toEqual(['idempotencyKey']);
    expect((await check(CreateBalanceTransferDto, { ...valid, idempotencyKey: 'x'.repeat(100) })).fields).toEqual([]);
  });

  it('trims the free-text fields', async () => {
    const { dto } = await check(CreateBalanceTransferDto, { ...valid, internalNote: '  moved  ', referenceNo: '  R1 ', idempotencyKey: ' transfer-key-0001 ' });
    expect(dto).toMatchObject({ internalNote: 'moved', referenceNo: 'R1', idempotencyKey: 'transfer-key-0001' });
  });

  it('accepts NO date, title or kind: a transfer is always dated now with generated wording', async () => {
    for (const extra of [{ effectiveDate: '2026-09-01' }, { title: 'Custom title' }, { kind: 'TRANSFER_OUT' }, { vendorId: 'other' }]) {
      const { fields } = await check(CreateBalanceTransferDto, { ...valid, ...extra });
      expect(fields).toEqual([Object.keys(extra)[0]]);
    }
  });
});

describe('TransferPreviewQueryDto', () => {
  it('needs fromCustomerId; toCustomerId is optional; both must be UUIDs', async () => {
    expect((await check(TransferPreviewQueryDto, { fromCustomerId: UUID_A })).fields).toEqual([]);
    expect((await check(TransferPreviewQueryDto, { fromCustomerId: UUID_A, toCustomerId: UUID_B })).fields).toEqual([]);
    expect((await check(TransferPreviewQueryDto, {})).fields).toEqual(['fromCustomerId']);
    expect((await check(TransferPreviewQueryDto, { fromCustomerId: 'x' })).fields).toEqual(['fromCustomerId']);
    expect((await check(TransferPreviewQueryDto, { fromCustomerId: UUID_A, toCustomerId: 'x' })).fields).toEqual(['toCustomerId']);
  });

  it('rejects undeclared params (forbidNonWhitelisted) — including a client-supplied vendorId', async () => {
    expect((await check(TransferPreviewQueryDto, { fromCustomerId: UUID_A, vendorId: 'other' })).fields).toEqual(['vendorId']);
  });
});
