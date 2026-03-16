import { UnauthorizedException } from '@nestjs/common';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { JwtStrategy } from './jwt.strategy';
import { vendorSuspendedKey } from '../vendor/vendor.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let cache: { get: jest.Mock };

  beforeEach(() => {
    cache = {
      get: jest.fn(),
    };
    strategy = new JwtStrategy(
      cache as unknown as CacheInvalidationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns the normalized auth user payload when the vendor is active', async () => {
    cache.get.mockResolvedValue(false);

    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'driver@test.com',
        name: 'Driver',
        role: 'DRIVER',
        vendorId: 'vendor-1',
        customerId: undefined,
      }),
    ).resolves.toEqual({
      userId: 'user-1',
      email: 'driver@test.com',
      name: 'Driver',
      role: 'DRIVER',
      vendorId: 'vendor-1',
      customerId: undefined,
    });
    expect(cache.get).toHaveBeenCalledWith(vendorSuspendedKey('vendor-1'));
  });

  it('skips the suspension lookup when the JWT payload has no vendorId', async () => {
    await expect(
      strategy.validate({
        sub: 'super-admin-1',
        email: 'admin@test.com',
        name: 'Admin',
        role: 'SUPER_ADMIN',
      }),
    ).resolves.toEqual({
      userId: 'super-admin-1',
      email: 'admin@test.com',
      name: 'Admin',
      role: 'SUPER_ADMIN',
      vendorId: undefined,
      customerId: undefined,
    });
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the vendor is suspended in cache', async () => {
    cache.get.mockResolvedValue(true);

    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'driver@test.com',
        name: 'Driver',
        role: 'DRIVER',
        vendorId: 'vendor-1',
      }),
    ).rejects.toThrow(
      new UnauthorizedException(
        'Your account has been suspended. Contact support.',
      ),
    );
  });
});
