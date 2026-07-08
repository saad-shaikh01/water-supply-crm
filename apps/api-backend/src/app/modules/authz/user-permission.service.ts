import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { PermissionEffect } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import type { PermissionPattern } from '@water-supply-crm/authz';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from './permission.service';
import { AuthzPolicyService } from './authz-policy.service';
import { UpdateOverridesDto } from './dto/update-overrides.dto';

/** User-centric access ops: role assignment and per-user permission overrides. */
@Injectable()
export class UserPermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly policy: AuthzPolicyService,
  ) {}

  async assignRole(actor: AuthUser, userId: string, roleId: string) {
    const user = await this.getUserInTenant(actor, userId);
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true, vendorId: true, name: true, permissions: { select: { permission: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    this.assertTenant(actor, role.vendorId);
    // A role can only be assigned to a user of the same tenant.
    if (role.vendorId !== user.vendorId) {
      throw new BadRequestException('Role belongs to a different vendor.');
    }
    // Privilege escalation: cannot assign a role granting permissions beyond your own.
    await this.policy.assertActorCanGrant(
      actor,
      role.permissions.map((p) => p.permission as PermissionPattern),
    );

    // Last-admin protection, concurrency-safe: check + write in one serializable txn.
    await this.prisma.$transaction(
      async (tx) => {
        await this.policy.assertReassignmentKeepsAdmin(user.vendorId, userId, roleId, tx as never);
        await tx.user.update({ where: { id: userId }, data: { roleId } });
      },
      { isolationLevel: 'Serializable' },
    );
    await this.permissions.invalidateUser(userId);

    await this.audit.log({
      vendorId: user.vendorId ?? undefined,
      userId: actor.userId,
      userName: actor.name,
      action: 'ASSIGN_ROLE',
      entity: 'User',
      entityId: userId,
      changes: { before: { roleId: user.roleId }, after: { roleId } },
    });
    return { userId, roleId, roleName: role.name };
  }

  async getEffective(actor: AuthUser, userId: string) {
    const user = await this.getUserInTenant(actor, userId);
    const [role, overrides, permissions] = await Promise.all([
      user.roleId
        ? this.prisma.role.findUnique({
            where: { id: user.roleId },
            select: { id: true, key: true, name: true },
          })
        : null,
      this.prisma.userPermissionOverride.findMany({
        where: { userId },
        select: { permission: true, effect: true, expiresAt: true },
      }),
      this.permissions.getEffectivePermissions(userId),
    ]);

    return {
      userId,
      role,
      overrides,
      permissions,
      pagePermissions: permissions.filter((p) => p.endsWith(':page')),
    };
  }

  async setOverrides(actor: AuthUser, userId: string, dto: UpdateOverridesDto) {
    const user = await this.getUserInTenant(actor, userId);

    const now = Date.now();
    for (const o of dto.overrides) {
      if (o.expiresAt && new Date(o.expiresAt).getTime() <= now) {
        throw new BadRequestException(`expiresAt must be in the future for "${o.permission}".`);
      }
    }

    // Privilege escalation: an ALLOW override cannot grant a permission the actor lacks.
    // DENY overrides are restrictive and always permitted.
    const allowPatterns = dto.overrides
      .filter((o) => o.effect === 'ALLOW')
      .map((o) => o.permission as PermissionPattern);
    await this.policy.assertActorCanGrant(actor, allowPatterns);

    const before = await this.prisma.userPermissionOverride.findMany({
      where: { userId },
      select: { permission: true, effect: true, expiresAt: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.userPermissionOverride.deleteMany({ where: { userId } });
      if (dto.overrides.length) {
        await tx.userPermissionOverride.createMany({
          data: dto.overrides.map((o) => ({
            userId,
            permission: o.permission,
            effect: o.effect as PermissionEffect,
            expiresAt: o.expiresAt ? new Date(o.expiresAt) : null,
            grantedById: actor.userId,
          })),
          skipDuplicates: true,
        });
      }
    });

    await this.permissions.invalidateUser(userId);
    await this.audit.log({
      vendorId: user.vendorId ?? undefined,
      userId: actor.userId,
      userName: actor.name,
      action: 'UPDATE_OVERRIDES',
      entity: 'User',
      entityId: userId,
      changes: { before, after: dto.overrides },
    });
    return this.getEffective(actor, userId);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  private async getUserInTenant(actor: AuthUser, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, vendorId: true, name: true, roleId: true },
    });
    if (!user) throw new NotFoundException('User not found');
    this.assertTenant(actor, user.vendorId);
    return user;
  }

  private assertTenant(actor: AuthUser, vendorId: string | null) {
    if (actor.vendorId && vendorId !== actor.vendorId) {
      throw new NotFoundException('User not found');
    }
  }
}
