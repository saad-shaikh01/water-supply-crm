/** Stubs for AuthService's P5 constructor deps (audit, sessions, twoFactor, policy) in unit specs. */
export function authExtraDeps(overrides: Partial<{ audit: unknown; sessions: unknown; twoFactor: unknown; policy: unknown }> = {}) {
  return [
    overrides.audit ?? { log: jest.fn(async () => undefined) },
    overrides.sessions ?? {
      create: jest.fn(),
      touch: jest.fn(),
      assertActive: jest.fn(),
      revoke: jest.fn(),
      revokeAllUserTokens: jest.fn(),
      userTokensRevokedSince: jest.fn(async () => false),
    },
    overrides.twoFactor ?? { isEnabled: jest.fn(async () => false) },
    overrides.policy ?? {
      get: jest.fn(async () => ({ loginMaxAttempts: 5, loginLockMinutes: 15, require2faForSuperAdmin: false })),
    },
  ] as never[];
}
