import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';

export const SECURITY_DEFAULTS = {
  loginMaxAttempts: 5,
  loginLockMinutes: 15,
  require2faForSuperAdmin: false,
} as const;

const KEYS = ['security.loginMaxAttempts', 'security.loginLockMinutes', 'security.require2faForSuperAdmin'];
const MEMO_MS = 5_000;

export interface SecurityPolicy {
  loginMaxAttempts: number;
  loginLockMinutes: number;
  require2faForSuperAdmin: boolean;
}

const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * Reads the security.* PlatformSetting rows with a short in-process memo and constant fallbacks,
 * so auth keeps working if the settings table is unreachable or a value is out of range.
 * (The settings module owns writes/validation; this is a read-only bridge for the auth path.)
 */
@Injectable()
export class AuthSecurityPolicyService {
  private readonly logger = new Logger(AuthSecurityPolicyService.name);
  private memo: { at: number; value: SecurityPolicy } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<SecurityPolicy> {
    if (this.memo && Date.now() - this.memo.at < MEMO_MS) return this.memo.value;
    const value: SecurityPolicy = { ...SECURITY_DEFAULTS };
    try {
      const rows = await this.prisma.platformSetting.findMany({ where: { key: { in: KEYS } } });
      for (const r of rows) {
        if (r.key === 'security.loginMaxAttempts' && intIn(r.value, 3, 20)) value.loginMaxAttempts = r.value;
        else if (r.key === 'security.loginLockMinutes' && intIn(r.value, 1, 1440)) value.loginLockMinutes = r.value;
        else if (r.key === 'security.require2faForSuperAdmin' && typeof r.value === 'boolean') {
          value.require2faForSuperAdmin = r.value;
        }
      }
    } catch (err) {
      this.logger.warn(`security settings unavailable, using defaults: ${(err as Error).message}`);
    }
    this.memo = { at: Date.now(), value };
    return value;
  }

  /** Called by the settings module after a write so changes apply immediately on this instance. */
  invalidate(): void {
    this.memo = null;
  }
}
