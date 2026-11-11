/** Plain-function stubs for AuthService's P5 constructor deps (audit, sessions, twoFactor, policy) in unit specs. */
const noop = async () => undefined;

export function authExtraDeps(overrides: Partial<{ audit: unknown; sessions: unknown; twoFactor: unknown; policy: unknown }> = {}) {
  return [
    overrides.audit ?? { log: noop },
    overrides.sessions ?? {
      create: async () => ({ id: 'sess-1' }),
      touch: noop,
      assertActive: noop,
      revoke: noop,
      revokeAllUserTokens: noop,
      userTokensRevokedSince: async () => false,
    },
    overrides.twoFactor ?? { isEnabled: async () => false },
    overrides.policy ?? {
      get: async () => ({ loginMaxAttempts: 5, loginLockMinutes: 15, require2faForSuperAdmin: false }),
    },
  ] as never[];
}
