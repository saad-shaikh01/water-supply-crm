import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth/auth.service';
import { getJwtSecret } from '../auth/jwt-secret';
import { VendorService } from '../vendor/vendor.service';
import { UserService } from '../user/user.service';

describe('defaults.customerGroupingEnabled applies to newly created vendors', () => {
  function make(defaultValue: boolean) {
    const vendorCreate = jest.fn(async ({ data }: any) => ({ id: 'v1', name: data.name, slug: data.slug, ...data }));
    const tx = {
      vendor: { create: vendorCreate },
      user: { create: jest.fn(async () => ({ id: 'u1', email: 'a@b.c', name: 'A', role: 'VENDOR_ADMIN' })) },
    };
    const prisma: any = {
      vendor: { findUnique: jest.fn(async () => null) },
      user: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const provisioning = { provisionInTx: jest.fn(async () => ({ roleIdByKey: new Map([['vendor_admin', 'r1']]) })) };
    const settings = { get: jest.fn(async () => defaultValue) };
    const svc = new VendorService(
      prisma,
      { invalidatePlatformDashboard: jest.fn(async () => undefined) } as never,
      { log: jest.fn(async () => undefined) } as never,
      provisioning as never,
      settings as never,
    );
    return { svc, vendorCreate, settings };
  }
  const dto: any = { name: 'V', slug: 'v', adminEmail: 'a@b.c', adminPassword: 'Passw0rd!x', adminName: 'A' };

  it.each([true, false])('new vendor gets platform default %s', async (flag) => {
    const { svc, vendorCreate, settings } = make(flag);
    await svc.create(dto);
    expect(settings.get).toHaveBeenCalledWith('defaults.customerGroupingEnabled');
    expect(vendorCreate.mock.calls[0][0].data.customerGroupingEnabled).toBe(flag);
  });
});

describe('password reset tokens are single-use (jti)', () => {
  function setup() {
    const store = new Map<string, unknown>();
    const cache = {
      get: jest.fn(async (k: string) => store.get(k)),
      set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
      del: jest.fn(async (k: string) => void store.delete(k)),
    };
    let token = '';
    const users = {
      findByEmail: jest.fn(async () => ({ id: 'u1', email: 'a@b.c', name: 'A', role: 'SUPER_ADMIN' })),
      findById: jest.fn(async () => ({ id: 'u1', email: 'a@b.c', name: 'A' })),
      updatePassword: jest.fn(async () => undefined),
    };
    const email = {
      sendPasswordReset: jest.fn(async (_t: string, _n: string, tk: string) => void (token = tk)),
      sendPasswordChanged: jest.fn(async () => undefined),
    };
    const jwt = new JwtService({ secret: getJwtSecret(), signOptions: { expiresIn: '1d' } });
    const sessions = { revokeAllUserTokens: jest.fn(async () => undefined) };
    const auth = new AuthService(
      users as never,
      jwt,
      email as never,
      cache as never,
      { log: jest.fn() } as never,
      sessions as never,
      {} as never,
      {} as never,
    );
    return { auth, email, users, getToken: () => token };
  }

  it('works once, then the same token is rejected; admin flag passed for SUPER_ADMIN', async () => {
    const { auth, email, users, getToken } = setup();
    await auth.generateResetToken('a@b.c');
    expect(email.sendPasswordReset).toHaveBeenCalledWith('a@b.c', 'A', expect.any(String), { admin: true });
    await expect(auth.verifyResetToken(getToken())).resolves.toEqual({ userId: 'u1' });
    await auth.resetPassword(getToken(), 'NewPassw0rd!');
    expect(users.updatePassword).toHaveBeenCalledTimes(1);
    await expect(auth.resetPassword(getToken(), 'Another1!')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.updatePassword).toHaveBeenCalledTimes(1);
  });

  it('rejects a legacy token with no jti', async () => {
    const { auth } = setup();
    const jwt = new JwtService({ secret: getJwtSecret() });
    const legacy = jwt.sign({ sub: 'u1', email: 'a@b.c', type: 'password-reset' }, { expiresIn: '15m' });
    await expect(auth.verifyResetToken(legacy)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('vendor user lists never expose platform (SUPER_ADMIN) accounts', () => {
  it('list queries are always scoped to the caller vendorId, even when role=SUPER_ADMIN is requested', async () => {
    const findMany = jest.fn(async () => []);
    const prisma: any = { user: { findMany, count: jest.fn(async () => 0) } };
    const cache = {
      vendorKey: (v: string, e: string) => `vendor:${v}:${e}`,
      get: jest.fn(async () => undefined),
      set: jest.fn(async () => undefined),
    };
    const svc = new UserService(prisma, cache as never, {} as never, {} as never, {} as never);
    await svc.findAllPaginated('v1', { role: ['SUPER_ADMIN'] } as never);
    await svc.findAllByVendor('v1');
    for (const call of findMany.mock.calls as any[]) {
      expect(call[0].where.vendorId).toBe('v1');
    }
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
