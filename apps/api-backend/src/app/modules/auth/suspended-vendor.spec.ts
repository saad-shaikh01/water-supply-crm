import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { VendorService, vendorSuspendedKey } from '../vendor/vendor.service';

/**
 * Audit M6: vendor suspension was enforced only from a Redis flag. Login never looked at
 * `vendor.isActive`, and a Redis flush/restart silently un-suspended every suspended vendor.
 */
describe('login of a user whose vendor is suspended', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash('Password123!', 4);
  });

  const auth = (user: unknown) =>
    new AuthService(
      { findByIdentifier: jest.fn(async () => user) } as never,
      {} as never,
      {} as never,
      { get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
    );

  it('is refused (DB state, even if the Redis flag was lost)', async () => {
    const svc = auth({ id: 'u1', password: hash, isActive: true, vendor: { id: 'v1', name: 'V', isActive: false } });
    await expect(svc.validateUser('a@x.test', 'Password123!')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.validateUser('a@x.test', 'Password123!')).rejects.toThrow(/suspended/i);
  });

  it('works for an active vendor, and for platform users who have no vendor', async () => {
    await expect(
      auth({ id: 'u1', password: hash, isActive: true, vendor: { id: 'v1', name: 'V', isActive: true } }).validateUser('a@x.test', 'Password123!'),
    ).resolves.toMatchObject({ id: 'u1' });
    await expect(
      auth({ id: 'sa', password: hash, isActive: true, vendor: null }).validateUser('a@x.test', 'Password123!'),
    ).resolves.toMatchObject({ id: 'sa' });
  });
});

describe('VendorService.onModuleInit re-seeds suspension flags from the database', () => {
  it('sets the Redis flag for every inactive vendor (survives a Redis flush + app restart)', async () => {
    const cache = { set: jest.fn(async () => undefined) };
    const prisma = { vendor: { findMany: jest.fn(async () => [{ id: 'v1' }, { id: 'v2' }]) } };
    const svc = new VendorService(prisma as never, cache as never, {} as never, {} as never);

    await svc.onModuleInit();

    expect(prisma.vendor.findMany).toHaveBeenCalledWith({ where: { isActive: false }, select: { id: true } });
    expect(cache.set).toHaveBeenCalledWith(vendorSuspendedKey('v1'), true, 0);
    expect(cache.set).toHaveBeenCalledWith(vendorSuspendedKey('v2'), true, 0);
  });

  it('never blocks startup if Redis or the DB is down', async () => {
    const prisma = { vendor: { findMany: jest.fn(async () => { throw new Error('db down'); }) } };
    const svc = new VendorService(prisma as never, { set: jest.fn() } as never, {} as never, {} as never);
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });
});
