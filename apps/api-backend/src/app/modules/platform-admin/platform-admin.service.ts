import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import type { AuthUser } from '@water-supply-crm/types';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomInt } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { AuthSessionService } from '../auth/session/auth-session.service';
import { TwoFactorService } from '../auth/two-factor/two-factor.service';
import { PermissionService } from '../authz/permission.service';
import { assertCanAssignRole, userInactiveKey, USER_INACTIVE_FLAG_TTL_MS } from '../user/user.service';
import { paginate } from '../../common/helpers/paginate';
import { CreatePlatformAdminDto, PlatformAdminQueryDto } from './dto/platform-admin.dto';

const MAX_SERIALIZABLE_RETRIES = 3;

/** Random temporary password: 16 chars, guaranteed upper/lower/digit/symbol. Never logged. */
export function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%*?';
  const pick = (s: string) => s[randomInt(s.length)];
  const body = randomBytes(12).toString('base64url').replace(/[-_]/g, 'x');
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols), ...body.slice(0, 12)];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * Platform (SUPER_ADMIN) account management. Every target must be a SUPER_ADMIN — this API cannot
 * touch vendor users. The last-active-admin rule lives here (AuthzPolicyService.assertNotLastAdmin
 * stays vendor-only).
 */
@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheInvalidationService,
    private readonly audit: AuditService,
    private readonly sessions: AuthSessionService,
    private readonly twoFactor: TwoFactorService,
    private readonly permissions: PermissionService,
    private readonly auth: AuthService,
  ) {}

  private log(
    actor: AuthUser,
    action: string,
    entityId: string,
    changes?: { before?: unknown; after?: unknown; reason?: string },
  ) {
    void this.audit.log({
      userId: actor.userId,
      userName: actor.name,
      action,
      entity: 'PlatformAdmin',
      entityId,
      changes,
    });
  }

  private async getTarget(id: string) {
    const target = await this.prisma.user.findFirst({ where: { id, role: UserRole.SUPER_ADMIN, isSystem: false } });
    if (!target) throw new NotFoundException('Platform administrator not found');
    return target;
  }

  private assertNotSelf(actor: AuthUser, id: string, code: string, message: string) {
    if (actor.userId === id) {
      throw new BadRequestException({ statusCode: 400, message, error: 'Bad Request', code });
    }
  }

  async list(query: PlatformAdminQueryDto) {
    const { page = 1, limit = 20, search, isActive } = query;
    const where: Prisma.UserWhereInput = {
      role: UserRole.SUPER_ADMIN,
      isSystem: false,
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          lastLoginAt: true,
          mustChangePassword: true,
          createdAt: true,
          twoFactor: { select: { enabledAt: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    const ids = rows.map((r) => r.id);
    const sessionCounts = ids.length
      ? await this.prisma.authSession.groupBy({
          by: ['userId'],
          where: { userId: { in: ids }, revokedAt: null, expiresAt: { gt: new Date() } },
          _count: { _all: true },
        })
      : [];
    const countBy = new Map(sessionCounts.map((s) => [s.userId, s._count._all]));
    const data = rows.map(({ twoFactor, ...r }) => ({
      ...r,
      twoFactorEnabled: !!twoFactor?.enabledAt,
      activeSessions: countBy.get(r.id) ?? 0,
    }));
    return paginate(data, total, page, limit);
  }

  async create(dto: CreatePlatformAdminDto, actor: AuthUser) {
    assertCanAssignRole(actor, UserRole.SUPER_ADMIN);
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('User with this email already exists');
    }
    const tempPassword = dto.password ? undefined : generateTempPassword();
    const hashed = await bcrypt.hash(dto.password ?? (tempPassword as string), 10);
    const role = await this.prisma.role.findFirst({ where: { vendorId: null, key: 'super_admin' }, select: { id: true } });

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          name: dto.name.trim(),
          email,
          password: hashed,
          role: UserRole.SUPER_ADMIN,
          vendorId: null,
          roleId: role?.id,
          mustChangePassword: true,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('User with this email already exists');
      }
      throw e;
    }
    this.log(actor, 'CREATE', user.id, { after: { email, name: user.name } });
    if (dto.sendInvite) {
      this.auth.generateResetToken(email).catch((e) => this.logger.warn(`invite email failed: ${(e as Error).message}`));
    }
    return {
      id: user.id,
      email,
      name: user.name,
      mustChangePassword: true,
      ...(tempPassword ? { tempPassword } : {}),
    };
  }

  async deactivate(id: string, reason: string, actor: AuthUser) {
    this.assertNotSelf(actor, id, 'SELF_DEACTIVATE', 'You cannot deactivate your own account');
    await this.getTarget(id);

    for (let attempt = 1; ; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            const target = await tx.user.findFirst({ where: { id, role: UserRole.SUPER_ADMIN } });
            if (!target) throw new NotFoundException('Platform administrator not found');
            if (!target.isActive) return; // idempotent
            const otherActive = await tx.user.count({
              where: { role: UserRole.SUPER_ADMIN, isActive: true, isSystem: false, id: { not: id } },
            });
            if (otherActive === 0) {
              throw new ConflictException({
                statusCode: 409,
                message: 'Cannot deactivate the last active platform administrator',
                error: 'Conflict',
                code: 'LAST_ADMIN',
              });
            }
            await tx.user.update({ where: { id }, data: { isActive: false } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (e) {
        // Serialization failure (P2034): a concurrent deactivation raced us — re-evaluate the count.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034' && attempt < MAX_SERIALIZABLE_RETRIES) continue;
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
          throw new ConflictException({
            statusCode: 409,
            message: 'Cannot deactivate the last active platform administrator',
            error: 'Conflict',
            code: 'LAST_ADMIN',
          });
        }
        throw e;
      }
    }

    await this.cache.set(userInactiveKey(id), true, USER_INACTIVE_FLAG_TTL_MS);
    await this.sessions.revokeAllUserTokens(id, 'DEACTIVATED', actor.userId);
    await this.permissions.invalidateUser(id);
    this.log(actor, 'DEACTIVATE', id, { before: { isActive: true }, after: { isActive: false }, reason });
    return { id, isActive: false };
  }

  async activate(id: string, actor: AuthUser) {
    await this.getTarget(id);
    await this.prisma.user.update({ where: { id }, data: { isActive: true } });
    await this.cache.del(userInactiveKey(id));
    await this.permissions.invalidateUser(id);
    this.log(actor, 'ACTIVATE', id, { before: { isActive: false }, after: { isActive: true } });
    return { id, isActive: true };
  }

  async resetPassword(id: string, mode: 'EMAIL' | 'TEMP', actor: AuthUser) {
    this.assertNotSelf(actor, id, 'SELF_RESET', 'Use change-password to change your own password');
    const target = await this.getTarget(id);
    let tempPassword: string | undefined;
    if (mode === 'TEMP') {
      tempPassword = generateTempPassword();
      await this.prisma.user.update({
        where: { id },
        data: { password: await bcrypt.hash(tempPassword, 10), mustChangePassword: true },
      });
    } else {
      if (!target.email) throw new BadRequestException('This administrator has no email address');
      await this.auth.generateResetToken(target.email);
    }
    await this.sessions.revokeAllUserTokens(id, 'PASSWORD_RESET', actor.userId);
    this.log(actor, 'RESET_PASSWORD', id, { after: { mode } });
    return mode === 'TEMP' ? { id, tempPassword } : { id, message: 'Password reset email sent' };
  }

  async resetTwoFactor(id: string, reason: string, actor: AuthUser) {
    this.assertNotSelf(actor, id, 'SELF_RESET', 'Use the security page to manage your own 2FA');
    await this.getTarget(id);
    await this.twoFactor.reset(id);
    await this.sessions.revokeAllUserTokens(id, '2FA_RESET', actor.userId);
    await this.clearLoginLocks(id);
    this.log(actor, 'RESET_2FA', id, { reason });
    return { id, message: 'Two-factor authentication reset' };
  }

  async unlock(id: string, actor: AuthUser) {
    await this.getTarget(id);
    await this.clearLoginLocks(id);
    this.log(actor, 'UNLOCK', id);
    return { id, message: 'Account unlocked' };
  }

  private async clearLoginLocks(id: string) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { email: true, phoneNumber: true } });
    const identifiers = [target?.email, target?.phoneNumber].filter((v): v is string => !!v).map((v) => v.trim().toLowerCase());
    await this.cache.del(`auth:lock:2fa:${id}`);
    await this.cache.del(`auth:fail:2fa:${id}`);
    for (const ident of identifiers) {
      await this.cache.del(`auth:lock:${ident}`);
      await this.cache.del(`auth:fail:${ident}`);
      await this.cache.deleteByPattern(`auth:lock:${ident}|*`);
      await this.cache.deleteByPattern(`auth:fail:${ident}|*`);
    }
  }

  async listSessions(id: string) {
    await this.getTarget(id);
    return this.sessions.list(id);
  }

  async revokeSession(id: string, sessionId: string, actor: AuthUser) {
    await this.getTarget(id);
    await this.sessions.revoke(sessionId, id, { reason: 'ADMIN_REVOKE', revokedById: actor.userId });
    this.log(actor, 'REVOKE_SESSION', id, { after: { sessionId } });
    return { message: 'Session revoked' };
  }
}
