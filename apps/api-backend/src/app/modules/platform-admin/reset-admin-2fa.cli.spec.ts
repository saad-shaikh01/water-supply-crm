// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resetAdmin2fa, parseArgs } = require('../../../../../../scripts/reset-admin-2fa.cjs');

/** Tiny in-memory prisma double: enough tables for the break-glass script. */
function fakePrisma() {
  const db = {
    users: [
      { id: 'a1', name: 'Root', email: 'root@x.test', role: 'SUPER_ADMIN' },
      { id: 'v1', name: 'Vend', email: 'vend@x.test', role: 'VENDOR_ADMIN' },
    ],
    factors: [{ userId: 'a1' }, { userId: 'other' }],
    codes: [{ userId: 'a1' }, { userId: 'a1' }, { userId: 'other' }],
    sessions: [
      { id: 's1', userId: 'a1', revokedAt: null as Date | null, revokeReason: null as string | null },
      { id: 's2', userId: 'a1', revokedAt: new Date(), revokeReason: 'x' },
      { id: 's3', userId: 'other', revokedAt: null as Date | null, revokeReason: null as string | null },
    ],
    audit: [] as any[],
  };
  const prisma: any = {
    db,
    user: { findUnique: jest.fn(async ({ where }: any) => db.users.find((u) => u.email === where.email) ?? null) },
    userTwoFactor: {
      count: jest.fn(async ({ where }: any) => db.factors.filter((f) => f.userId === where.userId).length),
      deleteMany: jest.fn(async ({ where }: any) => void (db.factors = db.factors.filter((f) => f.userId !== where.userId))),
    },
    userRecoveryCode: {
      count: jest.fn(async ({ where }: any) => db.codes.filter((f) => f.userId === where.userId).length),
      deleteMany: jest.fn(async ({ where }: any) => void (db.codes = db.codes.filter((f) => f.userId !== where.userId))),
    },
    authSession: {
      count: jest.fn(async ({ where }: any) => db.sessions.filter((s) => s.userId === where.userId && s.revokedAt === null).length),
      updateMany: jest.fn(
        async ({ where, data }: any) =>
          void db.sessions.filter((s) => s.userId === where.userId && s.revokedAt === null).forEach((s) => Object.assign(s, data)),
      ),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => void db.audit.push(data)) },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return prisma;
}

describe('scripts/reset-admin-2fa.cjs (break-glass)', () => {
  it('dry run reports but changes nothing', async () => {
    const p = fakePrisma();
    const res = await resetAdmin2fa(p, 'ROOT@x.test ', { dryRun: true });
    expect(res).toMatchObject({ userId: 'a1', hadFactor: true, recoveryCodes: 2, sessionsRevoked: 1, dryRun: true });
    expect(p.db.factors).toHaveLength(2);
    expect(p.db.codes).toHaveLength(3);
    expect(p.db.audit).toHaveLength(0);
  });

  it('applies: removes only the target factor + codes, revokes only active sessions, audits', async () => {
    const p = fakePrisma();
    await resetAdmin2fa(p, 'root@x.test');
    expect(p.db.factors).toEqual([{ userId: 'other' }]);
    expect(p.db.codes).toEqual([{ userId: 'other' }]);
    expect(p.db.sessions.find((s: any) => s.id === 's1')).toMatchObject({ revokeReason: '2FA_RESET' });
    expect(p.db.sessions.find((s: any) => s.id === 's1').revokedAt).toBeInstanceOf(Date);
    expect(p.db.sessions.find((s: any) => s.id === 's2').revokeReason).toBe('x');
    expect(p.db.sessions.find((s: any) => s.id === 's3').revokedAt).toBeNull();
    expect(p.db.audit).toHaveLength(1);
    expect(p.db.audit[0]).toMatchObject({ action: 'RESET_2FA_CLI', entity: 'TwoFactor', userId: 'a1' });
  });

  it('refuses non-SUPER_ADMIN and unknown users and touches nothing', async () => {
    const p = fakePrisma();
    await expect(resetAdmin2fa(p, 'vend@x.test')).rejects.toThrow(/No SUPER_ADMIN found/);
    await expect(resetAdmin2fa(p, 'nobody@x.test')).rejects.toThrow(/No SUPER_ADMIN found/);
    await expect(resetAdmin2fa(p, '  ')).rejects.toThrow(/--email/);
    expect(p.$transaction).not.toHaveBeenCalled();
    expect(p.db.factors).toHaveLength(2);
  });

  it('parses args', () => {
    expect(parseArgs(['--email', 'a@b.c', '--yes'])).toEqual({ email: 'a@b.c', yes: true });
    expect(parseArgs(['--email=a@b.c'])).toEqual({ email: 'a@b.c', yes: false });
  });
});
