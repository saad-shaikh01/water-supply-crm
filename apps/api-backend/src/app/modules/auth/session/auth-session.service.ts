import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';

/** Must outlive the access-token lifetime (1d) so a revoked `sid` can never be replayed. */
export const SESSION_REVOKED_FLAG_TTL_MS = 25 * 60 * 60 * 1000;
/** Mirrors the refresh-token TTL (7d). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Redis flag read by JwtStrategy when the JWT carries a `sid`. */
export const sessionRevokedKey = (sid: string) => `auth:session:revoked:${sid}`;
/** "Every token issued before this epoch-second is void" marker (see revokeAllUserTokens). */
export const userRevokedBeforeKey = (userId: string) => `auth:user:revoked-before:${userId}`;

export type SessionRevokeReason =
  | 'USER_REVOKE'
  | 'ADMIN_REVOKE'
  | 'PASSWORD_RESET'
  | 'DEACTIVATED'
  | '2FA_RESET'
  | 'LOGOUT'
  | 'SESSIONS_REVOKED';

export interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheInvalidationService,
  ) {}

  create(userId: string, ctx: SessionContext = {}) {
    return this.prisma.authSession.create({
      data: {
        userId,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
  }

  /** Throws 401 when the session was revoked / expired / does not exist. */
  async assertActive(sessionId: string): Promise<void> {
    if (await this.cache.get<boolean>(sessionRevokedKey(sessionId))) {
      throw new UnauthorizedException('Session has been revoked');
    }
    const s = await this.prisma.authSession.findUnique({ where: { id: sessionId } });
    if (!s || s.revokedAt || s.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session has been revoked');
    }
  }

  /** Slide expiry on refresh. */
  touch(sessionId: string, ctx: SessionContext = {}) {
    return this.prisma.authSession.update({
      where: { id: sessionId },
      data: {
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        ...(ctx.ip ? { ip: ctx.ip } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent.slice(0, 500) } : {}),
      },
    });
  }

  async list(userId: string, currentSid?: string) {
    const rows = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      current: s.id === currentSid,
    }));
  }

  countActive(userId: string) {
    return this.prisma.authSession.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } });
  }

  /** Revoke one session owned by `ownerUserId` (404 when it is not theirs / already gone). */
  async revoke(
    sessionId: string,
    ownerUserId: string,
    opts: { reason: SessionRevokeReason; revokedById?: string },
  ): Promise<void> {
    const res = await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId: ownerUserId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: opts.revokedById ?? null, revokeReason: opts.reason },
    });
    if (res.count === 0) throw new NotFoundException('Session not found');
    await this.cache.set(sessionRevokedKey(sessionId), true, SESSION_REVOKED_FLAG_TTL_MS);
  }

  /** Revoke every active session of a user (optionally keeping one). Returns the number revoked. */
  async revokeAll(
    userId: string,
    opts: { reason: SessionRevokeReason; revokedById?: string; exceptSessionId?: string },
  ): Promise<number> {
    const active = await this.prisma.authSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        ...(opts.exceptSessionId ? { id: { not: opts.exceptSessionId } } : {}),
      },
      select: { id: true },
    });
    if (active.length === 0) return 0;
    const ids = active.map((s) => s.id);
    await this.prisma.authSession.updateMany({
      where: { id: { in: ids }, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: opts.revokedById ?? null, revokeReason: opts.reason },
    });
    await Promise.all(ids.map((id) => this.cache.set(sessionRevokedKey(id), true, SESSION_REVOKED_FLAG_TTL_MS)));
    return ids.length;
  }

  /**
   * Role-agnostic "log this user out everywhere": revokes AuthSession rows AND writes a
   * revoked-before marker so access/refresh tokens of users without an AuthSession (every role
   * except SUPER_ADMIN) issued earlier stop working too.
   */
  async revokeAllUserTokens(userId: string, reason: SessionRevokeReason, revokedById?: string): Promise<void> {
    await this.revokeAll(userId, { reason, revokedById });
    await this.cache.set(userRevokedBeforeKey(userId), Math.floor(Date.now() / 1000), SESSION_TTL_MS);
  }

  async userTokensRevokedSince(userId: string, issuedAtSec: number | undefined): Promise<boolean> {
    const marker = await this.cache.get<number>(userRevokedBeforeKey(userId));
    if (!marker) return false;
    return issuedAtSec === undefined || issuedAtSec < marker;
  }
}
