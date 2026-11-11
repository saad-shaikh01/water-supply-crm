import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../../common/helpers/paginate';
import { ListImpersonationQueryDto, StartImpersonationDto } from './dto/impersonation.dto';

export const impersonationActiveKey = (sid: string) => `imp:active:${sid}`;
export const impersonationHandoffKey = (code: string) => `imp:handoff:${code}`;

const HANDOFF_TTL_MS = 60_000;
const ENTITY = 'ImpersonationSession';

export function maxTtlMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const v = parseInt(env.IMPERSONATION_MAX_TTL_MIN ?? '60', 10);
  return Number.isFinite(v) && v > 0 ? Math.min(v, 60) : 60;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class ImpersonationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheInvalidationService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  async start(actor: AuthUser, dto: StartImpersonationDto, meta: RequestMeta = {}) {
    if (actor.role !== 'SUPER_ADMIN' || actor.impersonation) {
      throw new ForbiddenException('Only a platform super admin can start an impersonation session.');
    }
    const reason = (dto.reason ?? '').trim();
    if (reason.length < 10 || reason.length > 500) {
      throw new BadRequestException('A reason of 10-500 characters is required.');
    }
    const ttl = dto.ttlMinutes ?? 30;
    if (ttl > maxTtlMinutes() || ttl < 1) {
      throw new BadRequestException(`ttlMinutes must be at most ${maxTtlMinutes()}.`);
    }

    const vendor = await this.prisma.vendor.findUnique({ where: { id: dto.vendorId }, select: { id: true, isActive: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (vendor.isActive === false) throw new BadRequestException('Cannot impersonate a suspended vendor.');

    // Only the vendor's VENDOR_ADMIN is a valid target (never SUPER_ADMIN / STAFF / DRIVER / CUSTOMER, never another vendor's user).
    const target = await this.prisma.user.findFirst({
      where: {
        vendorId: vendor.id,
        role: 'VENDOR_ADMIN',
        isActive: true,
        ...(dto.targetUserId ? { id: dto.targetUserId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true },
    });
    if (!target) throw new BadRequestException('No active vendor admin found to impersonate for this vendor.');

    // A new session for the same actor + vendor supersedes the old one.
    const open = await this.prisma.impersonationSession.findMany({
      where: { actorId: actor.userId, vendorId: vendor.id, endedAt: null },
      select: { id: true },
    });
    for (const s of open) await this.end(s.id, 'SUPERSEDED', { userId: actor.userId, name: actor.name }, { silent: true });

    const expiresAt = new Date(Date.now() + ttl * 60_000);
    const session = await this.prisma.impersonationSession.create({
      data: {
        actorId: actor.userId,
        actorName: actor.name,
        vendorId: vendor.id,
        targetUserId: target.id,
        targetName: target.name,
        mode: dto.mode,
        reason,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500),
        expiresAt,
      },
    });

    await this.cache.set(impersonationActiveKey(session.id), true, ttl * 60_000);
    const code = randomBytes(32).toString('hex');
    await this.cache.set(impersonationHandoffKey(code), { sid: session.id }, HANDOFF_TTL_MS);

    await this.audit.log({
      vendorId: vendor.id,
      userId: actor.userId,
      userName: actor.name,
      action: 'IMPERSONATION_START',
      entity: ENTITY,
      entityId: session.id,
      changes: { after: { reason, mode: dto.mode, targetUserId: target.id, ttlMinutes: ttl, ip: meta.ip, ua: meta.userAgent?.slice(0, 200) } },
    });

    const base = (process.env.VENDOR_DASHBOARD_URL || 'http://localhost:3000').replace(/\/+$/, '');
    return {
      sessionId: session.id,
      handoffUrl: `${base}/auth/impersonate?code=${code}`,
      expiresAt,
      target: { id: target.id, name: target.name, email: target.email },
    };
  }

  /** Single-use: the code is deleted on read and handoffUsedAt is claimed atomically. */
  async exchange(code: string, meta: RequestMeta = {}) {
    const key = impersonationHandoffKey(code);
    const stored = await this.cache.get<{ sid: string }>(key);
    if (!stored?.sid) throw new UnauthorizedException('Invalid or expired handoff code');
    await this.cache.del(key);

    const now = new Date();
    const claimed = await this.prisma.impersonationSession.updateMany({
      where: { id: stored.sid, handoffUsedAt: null, endedAt: null, expiresAt: { gt: now } },
      data: { handoffUsedAt: now },
    });
    if (!claimed.count) throw new UnauthorizedException('Invalid or expired handoff code');

    const session = await this.prisma.impersonationSession.findUnique({ where: { id: stored.sid } });
    if (!session || !(await this.cache.get(impersonationActiveKey(session.id)))) {
      throw new UnauthorizedException('Impersonation session is no longer active');
    }
    const target = await this.prisma.user.findFirst({
      where: { id: session.targetUserId, vendorId: session.vendorId, role: 'VENDOR_ADMIN', isActive: true },
    });
    if (!target) throw new UnauthorizedException('Impersonation target is no longer available');

    const expiresInSec = Math.max(1, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000));
    const access_token = this.jwt.sign(
      {
        sub: target.id,
        email: target.email,
        name: target.name,
        role: 'VENDOR_ADMIN',
        vendorId: target.vendorId,
        imp: { sid: session.id, actorId: session.actorId, actorName: session.actorName, mode: session.mode },
      },
      { expiresIn: expiresInSec },
    );

    await this.audit.log({
      vendorId: session.vendorId,
      userId: session.actorId,
      userName: session.actorName,
      action: 'IMPERSONATION_EXCHANGE',
      entity: ENTITY,
      entityId: session.id,
      changes: { after: { reason: session.reason, mode: session.mode, targetUserId: target.id, ip: meta.ip, ua: meta.userAgent?.slice(0, 200) } },
    });

    return {
      access_token,
      expires_in: expiresInSec,
      user: { id: target.id, email: target.email, name: target.name, role: target.role, vendorId: target.vendorId },
      impersonation: {
        sessionId: session.id,
        actorName: session.actorName,
        mode: session.mode,
        expiresAt: session.expiresAt,
      },
    };
  }

  /** Ends a session (idempotent). `reason` EXIT is used by the impersonated tab, REVOKED by a super admin. */
  async end(
    sessionId: string,
    reason: 'EXIT' | 'REVOKED' | 'SUPERSEDED' | 'EXPIRED' | 'SUSPENDED',
    by: { userId: string; name: string },
    opts: { silent?: boolean } = {},
  ) {
    await this.cache.del(impersonationActiveKey(sessionId));
    const res = await this.prisma.impersonationSession.updateMany({
      where: { id: sessionId, endedAt: null },
      data: { endedAt: new Date(), endedReason: reason },
    });
    const session = await this.prisma.impersonationSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Impersonation session not found');
    if (res.count && !opts.silent) {
      await this.audit.log({
        vendorId: session.vendorId,
        userId: session.actorId,
        userName: session.actorName,
        action: reason === 'REVOKED' ? 'IMPERSONATION_REVOKE' : 'IMPERSONATION_END',
        entity: ENTITY,
        entityId: session.id,
        changes: { after: { endedReason: reason, endedBy: by.userId, actionCount: session.actionCount } },
      });
    }
    return session;
  }

  /** Close sessions whose TTL elapsed without an explicit exit (lazy cleanup, called by list). */
  async closeExpired(now = new Date()) {
    return this.prisma.impersonationSession.updateMany({
      where: { endedAt: null, expiresAt: { lt: now } },
      data: { endedAt: now, endedReason: 'EXPIRED' },
    });
  }

  async list(query: ListImpersonationQueryDto) {
    await this.closeExpired();
    const { page = 1, limit = 20, vendorId, actorId, active } = query;
    const where: any = {};
    if (vendorId) where.vendorId = vendorId;
    if (actorId) where.actorId = actorId;
    if (active === true) where.endedAt = null;
    if (active === false) where.endedAt = { not: null };
    const [data, total] = await Promise.all([
      this.prisma.impersonationSession.findMany({ where, orderBy: { startedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.impersonationSession.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  /** Counts one mutating request made under a session (used by the audit interceptor). */
  async recordAction(
    imp: { sessionId: string; actorId: string; actorName: string },
    vendorId: string | undefined,
    detail: { method: string; path: string; status: number },
  ) {
    try {
      await this.prisma.impersonationSession.update({ where: { id: imp.sessionId }, data: { actionCount: { increment: 1 } } });
    } catch {
      /* counting must never break the request */
    }
    await this.audit.log({
      vendorId,
      userId: imp.actorId,
      userName: imp.actorName,
      action: 'IMPERSONATED_REQUEST',
      entity: ENTITY,
      entityId: imp.sessionId,
      changes: { after: { ...detail, actorId: imp.actorId } },
    });
  }

  async recordForbidden(
    imp: { sessionId: string; actorId: string; actorName: string },
    vendorId: string | undefined,
    detail: { method: string; path: string; mode: string },
  ) {
    await this.audit.log({
      vendorId,
      userId: imp.actorId,
      userName: imp.actorName,
      action: 'IMPERSONATION_FORBIDDEN',
      entity: ENTITY,
      entityId: imp.sessionId,
      changes: { after: detail },
    });
  }
}
