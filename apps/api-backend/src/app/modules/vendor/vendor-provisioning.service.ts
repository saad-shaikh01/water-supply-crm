import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { Prisma } from '@prisma/client';
import { LEGACY_ROLE_TO_KEY, ensureVendorRoles, type RoleKey } from '@water-supply-crm/authz';
import type { AuthUser } from '@water-supply-crm/types';
import { PermissionService } from '../authz/permission.service';
import { AuditService } from '../audit/audit.service';

/**
 * Starter customer-flag catalogue (owner-approved 2026-10-05). Vendors edit/extend these
 * freely afterwards; they are seeded only into a vendor that has NO flag categories yet.
 */
export const DEFAULT_CUSTOMER_FLAG_CATEGORIES: readonly { name: string; color: string; defaultMessage: string }[] = [
  { name: 'VIP', color: '#f59e0b', defaultMessage: 'VIP customer — prioritise service.' },
  { name: 'Credit Hold', color: '#ef4444', defaultMessage: 'Credit on hold — collect payment before delivery.' },
  { name: 'Problem Customer', color: '#f97316', defaultMessage: 'Known issues with this customer — handle with care.' },
  { name: 'High Priority', color: '#a855f7', defaultMessage: 'High-priority customer — deliver on time.' },
  { name: 'Commercial', color: '#3b82f6', defaultMessage: 'Commercial account.' },
];

export interface ProvisionResult {
  rolesCreated: number;
  driftGrantsAdded: number;
  usersBackfilled: number;
  customerFlagCategoriesSeeded: number;
  /** Users whose roleId this run set — their cached (empty) permission set must be dropped. */
  backfilledUserIds: string[];
  roleIdByKey: Map<RoleKey, string>;
}

/**
 * The MANDATORY onboarding setup every vendor needs before its first login works:
 * system roles + their permissions, role-less users, and starter catalogues that have no
 * lazy default. Everything else (notification toggles, policy configs, extra-labour /
 * vehicle service types, the walk-in sentinel van…) already self-initialises on first
 * use and is deliberately NOT duplicated here.
 *
 * Idempotent: safe to run on a brand-new vendor (inside its creation transaction), and
 * again later as the super-admin "repair" action.
 */
@Injectable()
export class VendorProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  /** Runs entirely on `tx`, so it can share the vendor-creation transaction. */
  async provisionInTx(tx: Prisma.TransactionClient, vendorId: string): Promise<ProvisionResult> {
    const { roleIdByKey, rolesCreated, driftGrantsAdded } = await ensureVendorRoles(tx, vendorId);

    // Users that exist without an RBAC role resolve an EMPTY permission set (every page
    // shows Access Denied) — attach them to the system role matching their legacy enum.
    const backfilledUserIds: string[] = [];
    for (const [legacy, key] of Object.entries(LEGACY_ROLE_TO_KEY)) {
      if (!key || key === 'super_admin') continue;
      const roleId = roleIdByKey.get(key);
      if (!roleId) continue;
      const targets = await tx.user.findMany({
        where: { vendorId, role: legacy as never, roleId: null },
        select: { id: true },
      });
      if (!targets.length) continue;
      await tx.user.updateMany({ where: { id: { in: targets.map((u) => u.id) } }, data: { roleId } });
      backfilledUserIds.push(...targets.map((u) => u.id));
    }

    // Same "seed only when empty" convention as the existing ensureSeeded() catalogues,
    // so a repair never resurrects a category an admin deliberately removed one-by-one.
    // Attendance categories are intentionally NOT seeded here: they are the reason for a
    // manual PRESENT marking (see StaffAttendanceService.markStatus), pending owner input.
    let customerFlagCategoriesSeeded = 0;
    if ((await tx.customerFlagCategory.count({ where: { vendorId } })) === 0) {
      const res = await tx.customerFlagCategory.createMany({
        data: DEFAULT_CUSTOMER_FLAG_CATEGORIES.map((c) => ({ vendorId, ...c })),
        skipDuplicates: true,
      });
      customerFlagCategoriesSeeded = res.count;
    }

    return {
      rolesCreated,
      driftGrantsAdded,
      usersBackfilled: backfilledUserIds.length,
      customerFlagCategoriesSeeded,
      backfilledUserIds,
      roleIdByKey,
    };
  }

  /** Super-admin "Repair Vendor Setup": re-runs provisioning on an existing vendor. */
  async repair(vendorId: string, actor?: AuthUser) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const result = await this.prisma.$transaction((tx) => this.provisionInTx(tx, vendorId), { timeout: 30_000 });

    // The effective-permission cache (1h TTL) holds an empty set for anyone who logged in
    // while role-less; a plain DB update would not clear it.
    await this.permissions.invalidateUsers(result.backfilledUserIds);

    const { roleIdByKey: _omit, backfilledUserIds: _ids, ...summary } = result;
    await this.audit.log({
      vendorId,
      userId: actor?.userId,
      userName: actor?.name,
      action: 'PROVISION',
      entity: 'Vendor',
      entityId: vendorId,
      changes: { after: summary },
    });
    return { vendorId, vendorName: vendor.name, ...summary };
  }
}
