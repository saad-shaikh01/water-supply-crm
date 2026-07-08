import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '@water-supply-crm/database';
import {
  ROLE_PRESETS,
  SYSTEM_ROLE_KEYS,
  getPresetPermissions,
  type RoleKey,
  type PermissionPattern,
} from '@water-supply-crm/authz';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from './permission.service';
import { AuthzPolicyService } from './authz-policy.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CloneRoleDto } from './dto/clone-role.dto';

/** Role management: CRUD, clone, reset-to-preset. Tenant-scoped and audited. */
@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly policy: AuthzPolicyService,
  ) {}

  // ── Reads ───────────────────────────────────────────────────────────────
  async list(actor: AuthUser) {
    const where = actor.vendorId ? { vendorId: actor.vendorId } : {};
    const roles = await this.prisma.role.findMany({
      where,
      include: { _count: { select: { users: true, permissions: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map(({ _count, ...r }) => ({
      ...r,
      userCount: _count.users,
      permissionCount: _count.permissions,
    }));
  }

  async findOne(actor: AuthUser, id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { select: { permission: true } }, _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    this.assertTenant(actor, role.vendorId);
    const { permissions, _count, ...rest } = role;
    return { ...rest, userCount: _count.users, permissions: permissions.map((p) => p.permission) };
  }

  // ── Mutations ───────────────────────────────────────────────────────────
  async create(actor: AuthUser, dto: CreateRoleDto) {
    await this.assertNameUnique(actor.vendorId, dto.name);
    const permissions = dedupe(dto.permissions);
    // Privilege escalation: cannot create a role granting permissions you don't hold.
    await this.policy.assertActorCanGrant(actor, permissions as PermissionPattern[]);

    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          vendorId: actor.vendorId,
          key: `custom_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
          name: dto.name,
          description: dto.description,
          color: dto.color,
          isSystem: false,
        },
      });
      if (permissions.length) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: created.id, permission })),
          skipDuplicates: true,
        });
      }
      return created;
    });

    await this.audit.log({
      vendorId: actor.vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: 'CREATE',
      entity: 'Role',
      entityId: role.id,
      changes: { after: { name: dto.name, permissions } },
    });
    return this.findOne(actor, role.id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateRoleDto) {
    const existing = await this.getOwned(actor, id);

    if (dto.name && dto.name !== existing.name) {
      await this.assertNameUnique(actor.vendorId, dto.name, id);
    }

    const permissionsChanged = dto.permissions !== undefined;
    const nextPermissions = permissionsChanged ? dedupe(dto.permissions ?? []) : undefined;
    const beforePermissions = existing.permissions.map((p) => p.permission);

    if (nextPermissions) {
      // Privilege escalation: cannot grant permissions you don't hold.
      await this.policy.assertActorCanGrant(actor, nextPermissions as PermissionPattern[]);
      // Last-admin: block a permission edit that strips this role's admin capability
      // when it is the vendor's only source of administrators.
      const wasAdmin = this.policy.patternsConferAdmin(beforePermissions as PermissionPattern[]);
      const willBeAdmin = this.policy.patternsConferAdmin(nextPermissions as PermissionPattern[]);
      if (wasAdmin && !willBeAdmin) {
        await this.policy.assertAdminSurvivesRoleChange(existing.vendorId, id);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id },
        data: { name: dto.name, description: dto.description, color: dto.color },
      });
      if (nextPermissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (nextPermissions.length) {
          await tx.rolePermission.createMany({
            data: nextPermissions.map((permission) => ({ roleId: id, permission })),
            skipDuplicates: true,
          });
        }
      }
    });

    // Minimal invalidation: only when the permission set actually changed.
    if (permissionsChanged) await this.permissions.invalidateRole(id);

    await this.audit.log({
      vendorId: existing.vendorId ?? undefined,
      userId: actor.userId,
      userName: actor.name,
      action: 'UPDATE',
      entity: 'Role',
      entityId: id,
      changes: {
        before: { name: existing.name, ...(permissionsChanged && { permissions: beforePermissions }) },
        after: { name: dto.name ?? existing.name, ...(nextPermissions && { permissions: nextPermissions }) },
      },
    });
    return this.findOne(actor, id);
  }

  async remove(actor: AuthUser, id: string) {
    const role = await this.getOwned(actor, id);
    if (role.isSystem) {
      throw new ForbiddenException('System roles cannot be deleted.');
    }
    if (role._count.users > 0) {
      throw new ConflictException('Role is assigned to users. Reassign them before deleting.');
    }
    await this.prisma.role.delete({ where: { id } }); // cascades RolePermission
    await this.audit.log({
      vendorId: role.vendorId ?? undefined,
      userId: actor.userId,
      userName: actor.name,
      action: 'DELETE',
      entity: 'Role',
      entityId: id,
      changes: { before: { name: role.name } },
    });
    return { id, deleted: true };
  }

  async clone(actor: AuthUser, id: string, dto: CloneRoleDto) {
    const source = await this.findOne(actor, id);
    await this.assertNameUnique(actor.vendorId, dto.name);
    // Privilege escalation: cannot clone a role whose permissions exceed your own.
    await this.policy.assertActorCanGrant(actor, source.permissions as PermissionPattern[]);

    const clone = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          vendorId: actor.vendorId,
          key: `custom_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
          name: dto.name,
          description: dto.description ?? source.description,
          color: source.color,
          isSystem: false, // clones are always independent custom roles
        },
      });
      if (source.permissions.length) {
        await tx.rolePermission.createMany({
          data: source.permissions.map((permission) => ({ roleId: created.id, permission })),
          skipDuplicates: true,
        });
      }
      return created;
    });

    await this.audit.log({
      vendorId: actor.vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: 'CLONE',
      entity: 'Role',
      entityId: clone.id,
      changes: { after: { name: dto.name, clonedFrom: id, permissions: source.permissions } },
    });
    return this.findOne(actor, clone.id);
  }

  async resetToPreset(actor: AuthUser, id: string) {
    const role = await this.getOwned(actor, id);
    if (!role.isSystem) {
      throw new BadRequestException('Only system roles can be reset to preset.');
    }
    if (!SYSTEM_ROLE_KEYS.includes(role.key as RoleKey)) {
      throw new BadRequestException('No preset exists for this role.');
    }
    const preset = getPresetPermissions(role.key as RoleKey);

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({
        data: preset.map((permission) => ({ roleId: id, permission })),
        skipDuplicates: true,
      });
      await tx.role.update({
        where: { id },
        data: { name: ROLE_PRESETS[role.key as RoleKey].name, description: ROLE_PRESETS[role.key as RoleKey].description },
      });
    });

    await this.permissions.invalidateRole(id);
    await this.audit.log({
      vendorId: role.vendorId ?? undefined,
      userId: actor.userId,
      userName: actor.name,
      action: 'RESET',
      entity: 'Role',
      entityId: id,
      changes: { after: { key: role.key, permissions: preset } },
    });
    return this.findOne(actor, id);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  /** Loads a role and asserts the actor's tenant owns it. */
  private async getOwned(actor: AuthUser, id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { select: { permission: true } }, _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    this.assertTenant(actor, role.vendorId);
    return role;
  }

  /** super_admin (null vendorId) may cross tenants; everyone else is scoped. */
  private assertTenant(actor: AuthUser, roleVendorId: string | null) {
    if (actor.vendorId && roleVendorId !== actor.vendorId) {
      throw new NotFoundException('Role not found');
    }
  }

  private async assertNameUnique(vendorId: string | null, name: string, excludeId?: string) {
    const clash = await this.prisma.role.findFirst({
      where: {
        vendorId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId && { id: { not: excludeId } }),
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException('A role with this name already exists.');
  }
}

function dedupe(permissions: string[]): string[] {
  return [...new Set(permissions)];
}
