import { Injectable } from '@nestjs/common';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

export const SECURITY_DEFAULTS = {
  loginMaxAttempts: 5,
  loginLockMinutes: 15,
  require2faForSuperAdmin: false,
} as const;

const MEMO_MS = 5_000;

export interface SecurityPolicy {
  loginMaxAttempts: number;
  loginLockMinutes: number;
  require2faForSuperAdmin: boolean;
}

/**
 * Read-only bridge from the auth path to the PlatformSettings registry (validated, cached),
 * with constant fallbacks so auth keeps working if settings are unavailable.
 */
@Injectable()
export class AuthSecurityPolicyService {
  private memo: { at: number; value: SecurityPolicy } | null = null;

  constructor(private readonly settings: PlatformSettingsService) {
    settings.registerOnChange(() => this.invalidate());
  }

  async get(): Promise<SecurityPolicy> {
    if (this.memo && Date.now() - this.memo.at < MEMO_MS) return this.memo.value;
    const value: SecurityPolicy = { ...SECURITY_DEFAULTS };
    try {
      const all = await this.settings.getAll();
      const max = all['security.loginMaxAttempts'];
      const lock = all['security.loginLockMinutes'];
      const req2fa = all['security.require2faForSuperAdmin'];
      if (typeof max === 'number') value.loginMaxAttempts = max;
      if (typeof lock === 'number') value.loginLockMinutes = lock;
      if (typeof req2fa === 'boolean') value.require2faForSuperAdmin = req2fa;
    } catch {
      /* constant fallbacks */
    }
    this.memo = { at: Date.now(), value };
    return value;
  }

  invalidate(): void {
    this.memo = null;
  }
}
