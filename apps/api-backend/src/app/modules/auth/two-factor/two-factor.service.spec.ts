import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import { TwoFactorService, normalizeRecoveryCode } from './two-factor.service';
import { decryptSecret } from './secret-crypto';

/** Minimal in-memory Prisma fake covering only what TwoFactorService touches. */
function makePrisma(users: Record<string, { password: string | null }>) {
  const factors = new Map<string, any>();
  let codes: any[] = [];
  const prisma: any = {
    factors,
    get codes() {
      return codes;
    },
    userTwoFactor: {
      findUnique: jest.fn(async ({ where }: any) => factors.get(where.userId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const cur = factors.get(where.userId);
        const next = cur ? { ...cur, ...update } : { ...create, enabledAt: null, lastUsedStep: null };
        factors.set(where.userId, next);
        return next;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const next = { ...factors.get(where.userId), ...data };
        factors.set(where.userId, next);
        return next;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const cur = factors.get(where.userId);
        if (!cur) return { count: 0 };
        const ok = cur.lastUsedStep == null || cur.lastUsedStep < where.OR[1].lastUsedStep.lt;
        if (!ok) return { count: 0 };
        factors.set(where.userId, { ...cur, ...data });
        return { count: 1 };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        factors.delete(where.userId);
        return { count: 1 };
      }),
    },
    userRecoveryCode: {
      count: jest.fn(async ({ where }: any) => codes.filter((c) => c.userId === where.userId && c.usedAt === null).length),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = codes.filter((c) => c.userId === where.userId && c.codeHash === where.codeHash && c.usedAt === null);
        hit.forEach((c) => Object.assign(c, data));
        return { count: hit.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        codes = codes.filter((c) => c.userId !== where.userId);
        return { count: 1 };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        codes.push(...data.map((d: any) => ({ ...d, usedAt: null })));
        return { count: data.length };
      }),
    },
    user: { findUnique: jest.fn(async ({ where }: any) => users[where.id] ?? null) },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return prisma;
}

describe('TwoFactorService', () => {
  let hash: string;
  let prisma: ReturnType<typeof makePrisma>;
  let policy: { get: jest.Mock };
  let svc: TwoFactorService;

  beforeAll(async () => {
    hash = await bcrypt.hash('Password123!', 4);
  });
  beforeEach(() => {
    prisma = makePrisma({ u1: { password: hash }, u2: { password: hash } });
    policy = { get: jest.fn(async () => ({ require2faForSuperAdmin: false })) };
    svc = new TwoFactorService(prisma as never, policy as never);
  });

  const secretOf = (userId: string) => decryptSecret(prisma.factors.get(userId).secretEnc);
  const codeAt = async (userId: string, offsetSec = 0) =>
    authenticator.clone({ epoch: Date.now() + offsetSec * 1000 }).generate(secretOf(userId));

  async function enable(userId = 'u1') {
    await svc.setup(userId, `${userId}@x.test`);
    // enrollment code consumed the current step -> use previous step so later "current" codes still work
    return svc.confirm(userId, await codeAt(userId, -30));
  }

  it('setup stores only the ciphertext, returns a QR + secret, pending until confirmed', async () => {
    const res = await svc.setup('u1', 'a@x.test');
    const row = prisma.factors.get('u1');
    expect(row.secretEnc).toMatch(/^v1:/);
    expect(row.secretEnc).not.toContain(res.secret);
    expect(row.enabledAt).toBeNull();
    expect(res.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.otpauthUri).toContain('otpauth://totp/');
    expect(await svc.isEnabled('u1')).toBe(false);
  });

  it('setup when already enabled -> 409; re-setup while pending replaces the secret', async () => {
    const first = await svc.setup('u1', 'a@x.test');
    const second = await svc.setup('u1', 'a@x.test');
    expect(second.secret).not.toBe(first.secret);
    await svc.confirm('u1', await codeAt('u1'));
    await expect(svc.setup('u1', 'a@x.test')).rejects.toBeInstanceOf(ConflictException);
  });

  it('confirm with a valid code enables, returns 10 distinct codes, stores only hashes', async () => {
    const { recoveryCodes } = await enable();
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    recoveryCodes.forEach((c) => expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/));
    expect(prisma.codes).toHaveLength(10);
    for (const stored of prisma.codes) {
      expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(recoveryCodes.map((c) => c.replace('-', ''))).not.toContain(stored.codeHash);
    }
    expect(await svc.isEnabled('u1')).toBe(true);
  });

  it('confirm with an invalid code -> 401 and stays pending', async () => {
    await svc.setup('u1', 'a@x.test');
    await expect(svc.confirm('u1', '000000')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.confirm('u1', 'abcdef')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await svc.isEnabled('u1')).toBe(false);
  });

  it('verify accepts the current and previous step, rejects 2 steps off', async () => {
    await enable();
    expect(await svc.verifyCode('u1', await codeAt('u1', 0))).toBe(true);
    prisma.factors.get('u1').lastUsedStep = null; // isolate window behaviour from replay guard
    expect(await svc.verifyCode('u1', await codeAt('u1', -30))).toBe(true);
    prisma.factors.get('u1').lastUsedStep = null;
    expect(await svc.verifyCode('u1', await codeAt('u1', -60))).toBe(false);
    expect(await svc.verifyCode('u1', await codeAt('u1', 60))).toBe(false);
  });

  it('rejects replay of the same code', async () => {
    await enable();
    const code = await codeAt('u1');
    expect(await svc.verifyCode('u1', code)).toBe(true);
    expect(await svc.verifyCode('u1', code)).toBe(false);
  });

  it('verifyCode is false for a pending (unconfirmed) factor', async () => {
    await svc.setup('u1', 'a@x.test');
    expect(await svc.verifyCode('u1', await codeAt('u1'))).toBe(false);
  });

  it('recovery code works once, is case/dash-insensitive, and is user-scoped', async () => {
    const { recoveryCodes } = await enable('u1');
    await enable('u2');
    const code = recoveryCodes[0];
    await expect(svc.verifyLogin('u1', { recoveryCode: code.toLowerCase() })).resolves.toEqual({
      usedRecoveryCode: true,
      remainingRecoveryCodes: 9,
    });
    await expect(svc.verifyLogin('u1', { recoveryCode: code })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.verifyLogin('u2', { recoveryCode: recoveryCodes[1] })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(normalizeRecoveryCode('abcde-fghjk ')).toBe('ABCDEFGHJK');
  });

  it('verifyLogin needs exactly one of code / recoveryCode', async () => {
    await enable();
    await expect(svc.verifyLogin('u1', {})).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.verifyLogin('u1', { code: '123456', recoveryCode: 'AAAAA-AAAAA' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(svc.verifyLogin('u1', { code: await codeAt('u1') })).resolves.toEqual({ usedRecoveryCode: false });
  });

  it('regenerate needs a fresh TOTP and invalidates old codes', async () => {
    const { recoveryCodes: old } = await enable();
    await expect(svc.regenerateRecoveryCodes('u1', '000000')).rejects.toBeInstanceOf(UnauthorizedException);
    const { recoveryCodes: fresh } = await svc.regenerateRecoveryCodes('u1', await codeAt('u1'));
    expect(fresh).toHaveLength(10);
    await expect(svc.verifyLogin('u1', { recoveryCode: old[0] })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.verifyLogin('u1', { recoveryCode: fresh[0] })).resolves.toMatchObject({ usedRecoveryCode: true });
  });

  it('disable requires password + code and removes everything', async () => {
    await enable();
    await expect(svc.disable('u1', 'wrong', await codeAt('u1'))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.disable('u1', 'Password123!', '000000')).rejects.toBeInstanceOf(UnauthorizedException);
    await svc.disable('u1', 'Password123!', await codeAt('u1'));
    expect(await svc.isEnabled('u1')).toBe(false);
    expect(prisma.codes).toHaveLength(0);
  });

  it('disable is blocked (409 2FA_REQUIRED) when enforcement is on', async () => {
    await enable();
    policy.get.mockResolvedValue({ require2faForSuperAdmin: true });
    const err = await svc.disable('u1', 'Password123!', await codeAt('u1')).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().code).toBe('2FA_REQUIRED');
    expect(await svc.isEnabled('u1')).toBe(true);
  });

  it('getStatus reports remaining recovery codes', async () => {
    expect(await svc.getStatus('u1')).toEqual({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0 });
    const { recoveryCodes } = await enable();
    await svc.verifyLogin('u1', { recoveryCode: recoveryCodes[0] });
    expect(await svc.getStatus('u1')).toMatchObject({ enabled: true, recoveryCodesRemaining: 9 });
  });
});
