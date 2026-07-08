import {
  Injectable,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { expandPattern, type Permission, type PermissionPattern } from '@water-supply-crm/authz';
import type { AuthUser } from '@water-supply-crm/types';
import { PermissionService } from './permission.service';

/**
 * Minimal Prisma client surface these checks need — so they can run against either the
 * root client or a transaction client (`tx`) for concurrency-safe last-admin checks.
 */
type Db = {
  role: { findMany: PrismaService['role']['findMany'] };
  user: { findMany: PrismaService['user']['findMany']; count: PrismaService['user']['count'] };
};

/**
 * Permission strings that confer administrative control (ability to add users or edit
 * access control). A role holding any of these — directly or via a wildcard — makes its
 * members "admin-capable" for last-admin protection.
 */
const ADMIN_CONFERRING = ['*', 'users:*', 'users:create', 'roles:*', 'roles:update'];

/**
 * Security guardrails for authorization mutations (Phase C6): privilege-escalation
 * prevention and last-administrator protection. Centralised so every role/user mutation
 * enforces the same rules.
 */
@Injectable()
export class AuthzPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  // ── Privilege escalation ──────────────────────────────────────────────────
  /**
   * Rejects granting any permission the actor does not themselves hold. Applies to role
   * create/update/clone and ALLOW overrides. `super_admin`/`vendor_admin` (`*`) hold
   * everything, so they pass; a narrower grantor cannot mint authority beyond their own.
   */
  async assertActorCanGrant(actor: AuthUser, patterns: PermissionPattern[]): Promise<void> {
    if (patterns.length === 0) return;
    const actorEffective = new Set(await this.permissions.getEffectivePermissions(actor.userId));

    const requested = new Set<Permission>();
    for (const pat of patterns) for (const p of expandPattern(pat)) requested.add(p);

    const missing = [...requested].filter((p) => !actorEffective.has(p));
    if (missing.length > 0) {
      const shown = missing.slice(0, 5).join(', ');
      throw new ForbiddenException(
        `You cannot grant permissions you do not hold: ${shown}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ''}.`,
      );
    }
  }

  // ── Last-admin protection ─────────────────────────────────────────────────
  /** Whether a permission set confers admin capability (users:create or roles:update). */
  patternsConferAdmin(patterns: PermissionPattern[]): boolean {
    const set = new Set<Permission>(patterns.flatMap((p) => expandPattern(p)));
    return set.has('users:create') || set.has('roles:update');
  }

  /**
   * Called when a role is LOSING admin capability (e.g. a permission-set edit that
   * removes users:create/roles:update). Blocks the change if this role is the vendor's
   * only source of active administrators.
   */
  async assertAdminSurvivesRoleChange(vendorId: string | null, roleId: string, db: Db = this.prisma): Promise<void> {
    if (!vendorId) return;
    const otherAdminRoles = await db.role.findMany({
      where: {
        vendorId,
        id: { not: roleId },
        permissions: { some: { permission: { in: ADMIN_CONFERRING } } },
      },
      select: { id: true },
    });
    if (otherAdminRoles.length > 0) {
      const others = await db.user.count({
        where: { vendorId, isActive: true, roleId: { in: otherAdminRoles.map((r) => r.id) } },
      });
      if (others > 0) return; // another admin source exists
    }
    const members = await db.user.count({ where: { vendorId, isActive: true, roleId } });
    if (members > 0) {
      throw new ConflictException('This change would leave the vendor with no administrator.');
    }
  }

  /** Whether a role currently confers administrative capability. */
  async isRoleAdminCapable(roleId: string, db: Db = this.prisma): Promise<boolean> {
    const roles = await db.role.findMany({
      where: { id: roleId, permissions: { some: { permission: { in: ADMIN_CONFERRING } } } },
      select: { id: true },
    });
    return roles.length > 0;
  }

  /** Active, admin-capable user ids for a vendor. */
  async getAdminUserIds(vendorId: string, db: Db = this.prisma): Promise<string[]> {
    const adminRoles = await db.role.findMany({
      where: { vendorId, permissions: { some: { permission: { in: ADMIN_CONFERRING } } } },
      select: { id: true },
    });
    if (adminRoles.length === 0) return [];
    const users = await db.user.findMany({
      where: { vendorId, isActive: true, roleId: { in: adminRoles.map((r) => r.id) } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /**
   * Blocks an operation (deactivate/delete) that would remove the vendor's last admin.
   * Pass the transaction client when called inside a serializable transaction.
   */
  async assertNotLastAdmin(vendorId: string | null, targetUserId: string, db: Db = this.prisma): Promise<void> {
    if (!vendorId) return; // platform (super-admin) users are not vendor-scoped
    const admins = await this.getAdminUserIds(vendorId, db);
    if (admins.includes(targetUserId) && admins.length <= 1) {
      throw new ConflictException('Cannot remove the last administrator for this vendor.');
    }
  }

  /**
   * Blocks a role reassignment that would drop the vendor's last admin (moving the only
   * admin-capable user to a non-admin role).
   */
  async assertReassignmentKeepsAdmin(
    vendorId: string | null,
    targetUserId: string,
    newRoleId: string,
    db: Db = this.prisma,
  ): Promise<void> {
    if (!vendorId) return;
    const admins = await this.getAdminUserIds(vendorId, db);
    const isTargetAdmin = admins.includes(targetUserId);
    if (!isTargetAdmin) return; // moving a non-admin never orphans admin control
    if (await this.isRoleAdminCapable(newRoleId, db)) return; // stays admin-capable
    if (admins.length <= 1) {
      throw new ConflictException('Cannot move the last administrator to a non-admin role.');
    }
  }
}
