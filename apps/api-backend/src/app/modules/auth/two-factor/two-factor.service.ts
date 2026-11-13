import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { AuthSecurityPolicyService } from '../security-policy.service';
import { decryptSecret, encryptSecret, hashRecoveryCode } from './secret-crypto';

export const TOTP_ISSUER = 'WaterCRM Admin';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_COUNT = 10;
const RECOVERY_LEN = 10;
const STEP_SECONDS = 30;

// SHA1 / 6 digits / 30s / +-1 step window (RFC 6238 defaults)
const totp = authenticator.clone({ window: 1, step: STEP_SECONDS, digits: 6 });

export const INVALID_2FA = () =>
  new UnauthorizedException({ statusCode: 401, message: 'Invalid authentication code', error: 'Unauthorized', code: 'INVALID_2FA_CODE' });

/** Strips spaces/dashes and upper-cases so "abcde-fghjk" matches "ABCDEFGHJK". */
export function normalizeRecoveryCode(code: string): string {
  return (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < RECOVERY_COUNT) {
    let c = '';
    for (let i = 0; i < RECOVERY_LEN; i++) c += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    codes.add(c);
  }
  return [...codes];
}

const display = (c: string) => `${c.slice(0, 5)}-${c.slice(5)}`;

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AuthSecurityPolicyService,
  ) {}

  async isEnabled(userId: string): Promise<boolean> {
    const row = await this.prisma.userTwoFactor.findUnique({ where: { userId }, select: { enabledAt: true } });
    return !!row?.enabledAt;
  }

  async getStatus(userId: string) {
    const row = await this.prisma.userTwoFactor.findUnique({ where: { userId } });
    const enabled = !!row?.enabledAt;
    const recoveryCodesRemaining = enabled
      ? await this.prisma.userRecoveryCode.count({ where: { userId, usedAt: null } })
      : 0;
    return { enabled, enabledAt: row?.enabledAt ?? null, recoveryCodesRemaining };
  }

  /** Creates (or replaces a PENDING) secret. 409 when 2FA is already enabled. */
  async setup(userId: string, label: string) {
    const existing = await this.prisma.userTwoFactor.findUnique({ where: { userId } });
    if (existing?.enabledAt) throw new ConflictException('Two-factor authentication is already enabled');
    const secret = authenticator.generateSecret(20); // 160-bit
    const secretEnc = encryptSecret(secret);
    await this.prisma.userTwoFactor.upsert({
      where: { userId },
      create: { userId, secretEnc },
      update: { secretEnc, enabledAt: null, lastUsedStep: null },
    });
    const otpauthUri = totp.keyuri(label, TOTP_ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUri);
    return { otpauthUri, qrDataUrl, secret };
  }

  /** Confirms a pending enrollment with a first valid code; returns recovery codes (shown once). */
  async confirm(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const row = await this.prisma.userTwoFactor.findUnique({ where: { userId } });
    if (!row) throw new ConflictException('Two-factor setup has not been started');
    if (row.enabledAt) throw new ConflictException('Two-factor authentication is already enabled');
    if (!(await this.checkTotp(row, code))) throw INVALID_2FA();
    await this.prisma.userTwoFactor.update({ where: { userId }, data: { enabledAt: new Date() } });
    return { recoveryCodes: await this.issueRecoveryCodes(userId) };
  }

  /** TOTP check for an ENABLED factor (login / sensitive actions). Replay-protected. */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const row = await this.prisma.userTwoFactor.findUnique({ where: { userId } });
    if (!row?.enabledAt) return false;
    return this.checkTotp(row, code);
  }

  /** Consumes a recovery code (single use). Returns remaining count, or null when invalid. */
  async consumeRecoveryCode(userId: string, code: string): Promise<number | null> {
    const normalized = normalizeRecoveryCode(code);
    if (normalized.length !== RECOVERY_LEN) return null;
    const res = await this.prisma.userRecoveryCode.updateMany({
      where: { userId, codeHash: hashRecoveryCode(normalized), usedAt: null },
      data: { usedAt: new Date() },
    });
    if (res.count === 0) return null;
    return this.prisma.userRecoveryCode.count({ where: { userId, usedAt: null } });
  }

  /** Login second factor: exactly one of `code` / `recoveryCode`. Throws 401 INVALID_2FA_CODE. */
  async verifyLogin(userId: string, input: { code?: string; recoveryCode?: string }) {
    const hasCode = !!input.code;
    const hasRecovery = !!input.recoveryCode;
    if (hasCode === hasRecovery) throw INVALID_2FA();
    if (hasCode) {
      if (!(await this.verifyCode(userId, input.code as string))) throw INVALID_2FA();
      return { usedRecoveryCode: false as const };
    }
    const remaining = await this.consumeRecoveryCode(userId, input.recoveryCode as string);
    if (remaining === null) throw INVALID_2FA();
    return { usedRecoveryCode: true as const, remainingRecoveryCodes: remaining };
  }

  /** Fresh TOTP required; old codes are invalidated. */
  async regenerateRecoveryCodes(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    if (!(await this.verifyCode(userId, code))) throw INVALID_2FA();
    return { recoveryCodes: await this.issueRecoveryCodes(userId) };
  }

  /** Self-service disable: password + TOTP; refused while enforcement is on. */
  async disable(userId: string, password: string, code: string): Promise<void> {
    if ((await this.policy.get()).require2faForSuperAdmin) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Two-factor authentication is required by platform policy',
        error: 'Conflict',
        code: '2FA_REQUIRED',
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
    if (!user?.password || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('Invalid password');
    }
    if (!(await this.verifyCode(userId, code))) throw INVALID_2FA();
    await this.reset(userId);
  }

  /** Removes the factor and all recovery codes (admin reset / disable). */
  async reset(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.userTwoFactor.deleteMany({ where: { userId } }),
    ]);
  }

  // ── internals ───────────────────────────────────────────────────────────────
  private async checkTotp(row: { userId: string; secretEnc: string; lastUsedStep: number | null }, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test((code ?? '').trim())) return false;
    const secret = decryptSecret(row.secretEnc);
    const delta = totp.checkDelta(code.trim(), secret); // null when invalid
    if (delta === null) return false;
    const step = Math.floor(Date.now() / 1000 / STEP_SECONDS) + delta;
    if (row.lastUsedStep != null && step <= row.lastUsedStep) return false;
    // Atomic replay guard: only the first request to claim this step wins.
    const claimed = await this.prisma.userTwoFactor.updateMany({
      where: {
        userId: row.userId,
        OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }],
      },
      data: { lastUsedStep: step },
    });
    return claimed.count === 1;
  }

  private async issueRecoveryCodes(userId: string): Promise<string[]> {
    const codes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.userRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.userRecoveryCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })),
      }),
    ]);
    return codes.map(display);
  }
}
