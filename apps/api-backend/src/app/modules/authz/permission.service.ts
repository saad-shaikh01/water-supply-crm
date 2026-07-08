import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import {
  resolveEffectivePermissions,
  hasPermission,
  type Permission,
  type PermissionPattern,
  type PermissionOverrideInput,
} from '@water-supply-crm/authz';

/** Effective-permission cache: 1h TTL + explicit invalidation on any change. */
const PERMS_CACHE_TTL_MS = 60 * 60 * 1000;
const permsKey = (userId: string) => `authz:perms:${userId}`;

/**
 * Resolves and caches a user's effective permission set using the Phase A engine.
 * The single place the backend turns (role + overrides) into a concrete permission
 * list — guards, /auth/me, and future services all go through here.
 */
@Injectable()
export class PermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheInvalidationService,
  ) {}

  /** Effective concrete permissions for a user (Redis-cached). */
  async getEffectivePermissions(userId: string): Promise<Permission[]> {
    const cached = await this.cache.get<Permission[]>(permsKey(userId));
    if (cached) return cached;

    const resolved = await this.resolveFromDb(userId);
    await this.cache.set(permsKey(userId), resolved, PERMS_CACHE_TTL_MS);
    return resolved;
  }

  private async resolveFromDb(userId: string): Promise<Permission[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roleRef: { include: { permissions: { select: { permission: true } } } },
        permissionOverrides: {
          select: { permission: true, effect: true, expiresAt: true },
        },
      },
    });
    if (!user) return [];

    const rolePermissions: PermissionPattern[] = (user.roleRef?.permissions ?? []).map(
      (p) => p.permission as PermissionPattern,
    );
    const overrides: PermissionOverrideInput[] = user.permissionOverrides.map((o) => ({
      permission: o.permission as PermissionPattern,
      effect: o.effect as 'ALLOW' | 'DENY',
      expiresAt: o.expiresAt,
    }));

    return resolveEffectivePermissions({ rolePermissions, overrides });
  }

  /** True if the user holds the given permission. */
  async can(userId: string, permission: Permission): Promise<boolean> {
    const effective = new Set(await this.getEffectivePermissions(userId));
    return hasPermission(effective, permission);
  }

  /** True if the user holds any of the given permissions. */
  async canAny(userId: string, permissions: readonly Permission[]): Promise<boolean> {
    const effective = new Set(await this.getEffectivePermissions(userId));
    return permissions.some((p) => hasPermission(effective, p));
  }

  /** True only if the user holds every given permission. */
  async canAll(userId: string, permissions: readonly Permission[]): Promise<boolean> {
    const effective = new Set(await this.getEffectivePermissions(userId));
    return permissions.every((p) => hasPermission(effective, p));
  }

  // ── Cache invalidation ────────────────────────────────────────────────────
  /** Invalidate one user's cached permissions (call on role/override change). */
  async invalidateUser(userId: string): Promise<void> {
    await this.cache.del(permsKey(userId));
  }

  async invalidateUsers(userIds: readonly string[]): Promise<void> {
    await Promise.all(userIds.map((id) => this.invalidateUser(id)));
  }

  /** Invalidate every user assigned to a role (call on role-permission change). */
  async invalidateRole(roleId: string): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { roleId },
      select: { id: true },
    });
    await this.invalidateUsers(users.map((u) => u.id));
  }
}
