import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID } from 'crypto';
import { UserService } from '../user/user.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import * as bcrypt from 'bcrypt';
import { getJwtSecret } from './jwt-secret';
import { AuthSessionService } from './session/auth-session.service';
import { TwoFactorService, INVALID_2FA } from './two-factor/two-factor.service';
import { AuthSecurityPolicyService } from './security-policy.service';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const REFRESH_KEY = (token: string) => `auth:refresh:${token}`;
/** Same message for "locked" and "wrong password" so a lock never confirms the account exists. */
const GENERIC_LOGIN_ERROR = 'Invalid credentials';
/** Per-IP failure budget is this many times the per-identifier budget (shared NATs / offices). */
const IP_ATTEMPT_MULTIPLIER = 5;

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

interface RefreshValue {
  userId: string;
  sessionId?: string;
  /** epoch seconds the token was issued (checked against the revoked-before marker). */
  iat?: number;
}

/** 2FA challenge / enrollment tokens are signed with a derived key so they can never pass as access tokens. */
function twoFactorTokenSecret(): string {
  return createHmac('sha256', getJwtSecret()).update('2fa').digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private emailService: EmailService,
    private cache: CacheInvalidationService,
    private audit: AuditService,
    private sessions: AuthSessionService,
    private twoFactor: TwoFactorService,
    private policy: AuthSecurityPolicyService,
  ) {}

  /** Case/whitespace variants of an identifier must share one counter. */
  private normalizeIdentifier(identifier: string): string {
    return (identifier ?? '').trim().toLowerCase();
  }

  private async lockedFor(keys: string[]): Promise<boolean> {
    for (const k of keys) if (await this.cache.get(k)) return true;
    return false;
  }

  /** Increments a failure counter; returns true when this failure tripped the lock. */
  private async registerFailure(failKey: string, lockKey: string, max: number, lockMs: number): Promise<boolean> {
    const fails = ((await this.cache.get<number>(failKey)) ?? 0) + 1;
    if (fails >= max) {
      await this.cache.set(lockKey, true, lockMs);
      await this.cache.del(failKey);
      return true;
    }
    await this.cache.set(failKey, fails, lockMs);
    return false;
  }

  async validateUser(identifier: string, pass: string, ctx: RequestContext = {}): Promise<any> {
    const id = this.normalizeIdentifier(identifier);
    const ip = ctx.ip;
    const suffix = ip ? `${id}|${ip}` : id;
    const lockKey = `auth:lock:${suffix}`;
    const failKey = `auth:fail:${suffix}`;
    const ipLockKey = ip ? `auth:lock-ip:${ip}` : null;
    const ipFailKey = ip ? `auth:fail-ip:${ip}` : null;

    const { loginMaxAttempts, loginLockMinutes } = await this.policy.get();
    const lockMs = loginLockMinutes * 60 * 1000;

    if (await this.lockedFor(ipLockKey ? [lockKey, ipLockKey] : [lockKey])) {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const user = await this.userService.findByIdentifier((identifier ?? '').trim());
    // user.password is null for no-login field staff (SALESMAN/LOADER) — always reject
    if (user && user.password && (await bcrypt.compare(pass, user.password))) {
      await this.cache.del(failKey);
      // Only revealed to someone who proved they know the password, so this leaks nothing.
      if (!user.isActive) {
        throw new UnauthorizedException('Your account has been deactivated. Contact your administrator.');
      }
      // Suspension is also recorded in the DB (vendor.isActive) — not only the Redis flag JwtStrategy reads.
      if (user.vendor && user.vendor.isActive === false) {
        throw new UnauthorizedException('Your account has been suspended. Contact support.');
      }
      const { password, ...result } = user;
      return result;
    }

    // Track failed attempts (per identifier+ip, plus a looser per-ip budget)
    const locked = await this.registerFailure(failKey, lockKey, loginMaxAttempts, lockMs);
    if (ipFailKey && ipLockKey) {
      await this.registerFailure(ipFailKey, ipLockKey, loginMaxAttempts * IP_ATTEMPT_MULTIPLIER, lockMs);
    }
    void this.audit.log({
      vendorId: user?.vendorId ?? undefined,
      userId: user?.id,
      userName: user?.name,
      action: locked ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
      entity: 'Auth',
      entityId: user?.id,
      changes: { after: { identifier: id, ip: ip ?? null } },
    });
    if (locked) throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    return null;
  }

  /**
   * Issues tokens. SUPER_ADMIN only: when 2FA is enabled (or enforced) returns a challenge /
   * enrollment response WITHOUT tokens. Every other role is byte-identical to before.
   */
  async login(user: any, ctx: RequestContext = {}) {
    if (user.role === 'SUPER_ADMIN') {
      if (await this.twoFactor.isEnabled(user.id)) {
        return {
          requires2fa: true,
          challengeToken: this.jwtService.sign(
            { sub: user.id, type: '2fa-challenge' },
            { secret: twoFactorTokenSecret(), expiresIn: '5m' },
          ),
        };
      }
      if ((await this.policy.get()).require2faForSuperAdmin) {
        return {
          requires2faEnrollment: true,
          enrollmentToken: this.jwtService.sign(
            { sub: user.id, type: '2fa-enroll' },
            { secret: twoFactorTokenSecret(), expiresIn: '10m' },
          ),
        };
      }
    }
    return this.generateTokens(user, ctx);
  }

  // ── 2FA login completion ────────────────────────────────────────────────────
  private async userFromTwoFactorToken(token: string, type: '2fa-challenge' | '2fa-enroll') {
    let payload: any;
    try {
      payload = this.jwtService.verify(token, { secret: twoFactorTokenSecret() });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload?.type !== type || !payload.sub) throw new UnauthorizedException('Invalid or expired token');
    const user = await this.userService.findById(payload.sub);
    if (!user || !user.isActive || user.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return user;
  }

  /** Brute-force budget for the second factor, per user (same thresholds as password login). */
  private async guardTwoFactorAttempt<T>(user: any, ctx: RequestContext, run: () => Promise<T>): Promise<T> {
    const failKey = `auth:fail:2fa:${user.id}`;
    const lockKey = `auth:lock:2fa:${user.id}`;
    if (await this.cache.get(lockKey)) throw INVALID_2FA();
    const { loginMaxAttempts, loginLockMinutes } = await this.policy.get();
    try {
      const out = await run();
      await this.cache.del(failKey);
      return out;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        const locked = await this.registerFailure(failKey, lockKey, loginMaxAttempts, loginLockMinutes * 60 * 1000);
        void this.audit.log({
          userId: user.id,
          userName: user.name,
          action: locked ? 'ACCOUNT_LOCKED' : 'LOGIN_2FA_FAILED',
          entity: 'Auth',
          entityId: user.id,
          changes: { after: { ip: ctx.ip ?? null } },
        });
      }
      throw err;
    }
  }

  async verifyTwoFactorLogin(
    dto: { challengeToken: string; code?: string; recoveryCode?: string },
    ctx: RequestContext = {},
  ) {
    const user = await this.userFromTwoFactorToken(dto.challengeToken, '2fa-challenge');
    const outcome = await this.guardTwoFactorAttempt(user, ctx, () =>
      this.twoFactor.verifyLogin(user.id, { code: dto.code, recoveryCode: dto.recoveryCode }),
    );
    void this.audit.log({
      userId: user.id,
      userName: user.name,
      action: 'LOGIN_2FA_OK',
      entity: 'Auth',
      entityId: user.id,
      changes: { after: { ip: ctx.ip ?? null, usedRecoveryCode: outcome.usedRecoveryCode } },
    });
    const tokens = await this.generateTokens(user, ctx);
    return { ...tokens, ...outcome };
  }

  async startTwoFactorEnrollment(enrollmentToken: string) {
    const user = await this.userFromTwoFactorToken(enrollmentToken, '2fa-enroll');
    return this.twoFactor.setup(user.id, user.email ?? user.id);
  }

  async confirmTwoFactorEnrollment(enrollmentToken: string, code: string, ctx: RequestContext = {}) {
    const user = await this.userFromTwoFactorToken(enrollmentToken, '2fa-enroll');
    const { recoveryCodes } = await this.guardTwoFactorAttempt(user, ctx, () => this.twoFactor.confirm(user.id, code));
    void this.audit.log({
      userId: user.id,
      userName: user.name,
      action: 'ENABLE_2FA',
      entity: 'TwoFactor',
      entityId: user.id,
      changes: { after: { via: 'login-enrollment' } },
    });
    const tokens = await this.generateTokens(user, ctx);
    return { ...tokens, recoveryCodes };
  }

  // ── refresh / logout ────────────────────────────────────────────────────────
  async refreshTokens(refreshToken: string, ctx: RequestContext = {}) {
    // Validate refresh token against Redis
    const stored = await this.cache.get<RefreshValue>(REFRESH_KEY(refreshToken));
    if (!stored) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (stored.sessionId) await this.sessions.assertActive(stored.sessionId);
    if (await this.sessions.userTokensRevokedSince(stored.userId, stored.iat)) {
      await this.cache.del(REFRESH_KEY(refreshToken));
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: delete old token, issue new pair
    await this.cache.del(REFRESH_KEY(refreshToken));
    const user = await this.userService.findById(stored.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or deactivated');
    }

    return this.generateTokens(user, ctx, stored.sessionId);
  }

  async logout(refreshToken: string): Promise<void> {
    const stored = await this.cache.get<RefreshValue>(REFRESH_KEY(refreshToken));
    await this.cache.del(REFRESH_KEY(refreshToken));
    if (stored?.sessionId) {
      await this.sessions
        .revoke(stored.sessionId, stored.userId, { reason: 'LOGOUT', revokedById: stored.userId })
        .catch(() => undefined); // already revoked is fine
    }
  }

  /**
   * Log `userId` out everywhere: AuthSession rows are revoked and a revoked-before marker voids any
   * access/refresh token issued earlier (covers roles that have no AuthSession). Signature is
   * a cross-phase contract (orchestration decision 3) — keep it.
   */
  async revokeUserSessions(userId: string): Promise<void> {
    await this.sessions.revokeAllUserTokens(userId, 'SESSIONS_REVOKED');
  }

  private async generateTokens(user: any, ctx: RequestContext = {}, existingSessionId?: string) {
    const payload: any = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      vendorId: user.vendorId,
    };

    if (user.role === 'CUSTOMER' && user.customer?.id) {
      payload.customerId = user.customer.id;
    }

    // Session tracking is SUPER_ADMIN only (P5): the `sid` claim lets a revoke take effect immediately.
    let sessionId: string | undefined;
    if (user.role === 'SUPER_ADMIN') {
      if (existingSessionId) {
        await this.sessions.touch(existingSessionId, ctx);
        sessionId = existingSessionId;
      } else {
        sessionId = (await this.sessions.create(user.id, ctx)).id;
      }
      payload.sid = sessionId;
    }

    const access_token = this.jwtService.sign(payload);

    // Generate opaque refresh token and store in Redis (7 days)
    const refreshToken = randomUUID();
    const refreshValue: RefreshValue = { userId: user.id, iat: Math.floor(Date.now() / 1000) };
    if (sessionId) refreshValue.sessionId = sessionId;
    await this.cache.set(REFRESH_KEY(refreshToken), refreshValue, REFRESH_TTL_MS);

    return {
      access_token,
      refresh_token: refreshToken,
      expires_in: 86400, // 1 day in seconds (matches JWT expiry in auth.module.ts)
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        vendorId: user.vendorId,
        ...(payload.customerId && { customerId: payload.customerId }),
        ...(user.role === 'SUPER_ADMIN' && { mustChangePassword: !!user.mustChangePassword }),
      },
    };
  }

  async getProfile(userId: string) {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const { password, ...result } = user;
    return result;
  }

  async generateResetToken(email: string): Promise<void> {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      // Don't reveal whether the email exists — always return silently
      this.logger.log(`Password reset requested for unknown email: ${email}`);
      return;
    }

    const token = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'password-reset' },
      { expiresIn: '15m' },
    );

    // Send the reset email (non-blocking — failure doesn't crash the request)
    await this.emailService.sendPasswordReset(user.email, user.name ?? 'User', token);
  }

  async verifyResetToken(token: string): Promise<{ userId: string }> {
    try {
      const payload = this.jwtService.verify(token);
      if (payload.type !== 'password-reset') {
        throw new UnauthorizedException('Invalid reset token');
      }
      return { userId: payload.sub };
    } catch {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const { userId } = await this.verifyResetToken(token);
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.userService.updatePassword(userId, hashedPassword);
    // A password reset must kill sessions opened with the old credentials.
    await this.sessions.revokeAllUserTokens(userId, 'PASSWORD_RESET');

    // Send confirmation email (non-blocking)
    const user = await this.userService.findById(userId);
    if (user) {
      await this.emailService.sendPasswordChanged(user.email, user.name ?? 'User');
    }
  }
}
