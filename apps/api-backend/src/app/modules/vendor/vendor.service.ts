import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import {
  Injectable,
  Logger,
  OnModuleInit,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { Prisma, UserRole } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import { VendorProvisioningService } from './vendor-provisioning.service';
import { paginate } from '../../common/helpers/paginate';
import { isLegacyVendor } from '../../common/tenant-gate/legacy-vendor-gate';
import { AuthService } from '../auth/auth.service';
import type { ListVendorsQueryDto } from './dto/list-vendors-query.dto';
import type { VendorUsersQueryDto } from './dto/vendor-users-query.dto';
import type { ResetAdminPasswordDto } from './dto/reset-admin-password.dto';

// Redis key used to block suspended vendor's users from authenticating
export const vendorSuspendedKey = (vendorId: string) =>
  `vendor:${vendorId}:suspended`;

@Injectable()
export class VendorService implements OnModuleInit {
  private readonly logger = new Logger(VendorService.name);

  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
    private audit: AuditService,
    private provisioning: VendorProvisioningService,
    @Optional() private platformSettings?: PlatformSettingsService,
    private auth?: AuthService,
  ) {}

  /**
   * Suspension is enforced per request from a Redis flag (cheap), with `vendor.isActive` as the
   * source of truth. A Redis flush/restart would silently un-suspend vendors, so re-seed every flag
   * from the database on boot.
   */
  async onModuleInit() {
    try {
      const suspended = await this.prisma.vendor.findMany({ where: { isActive: false }, select: { id: true } });
      await Promise.all(suspended.map((v) => this.cache.set(vendorSuspendedKey(v.id), true, 0)));
      if (suspended.length) this.logger.log(`Re-seeded suspension flags for ${suspended.length} vendor(s)`);
    } catch (e) {
      this.logger.error(`Could not re-seed vendor suspension flags: ${(e as Error).message}`);
    }
  }

  /**
   * Create a vendor, provision it (system roles, starter catalogues) and create its
   * VENDOR_ADMIN — all in ONE transaction, every write on `tx`. Anything that fails
   * (including a duplicate admin email) rolls the whole vendor back, so a half-built
   * vendor with no usable admin can never be left behind.
   * Returns `{ vendor, admin, provisioning: { summary } }`.
   */
  async create(createVendorDto: CreateVendorDto, actor?: AuthUser) {
    const { adminEmail, adminPassword, adminName, ...vendorData } = createVendorDto;

    const existing = await this.prisma.vendor.findUnique({
      where: { slug: vendorData.slug },
    });
    if (existing) {
      throw new ConflictException('Vendor with this slug already exists');
    }
    const emailTaken = await this.prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });
    if (emailTaken) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    // Platform default (defaults.customerGroupingEnabled) applies to NEW vendors only.
    const groupingDefault = (await this.platformSettings?.get<boolean>('defaults.customerGroupingEnabled')) === true;

    let created;
    try {
      created = await this.prisma.$transaction(
        async (tx) => {
          const vendor = await tx.vendor.create({ data: { ...vendorData, customerGroupingEnabled: groupingDefault } });
          const provisioned = await this.provisioning.provisionInTx(tx, vendor.id);
          const admin = await tx.user.create({
            data: {
              email: adminEmail,
              password: hashedPassword,
              name: adminName,
              role: UserRole.VENDOR_ADMIN,
              vendorId: vendor.id,
              roleId: provisioned.roleIdByKey.get('vendor_admin'),
            },
            select: { id: true, email: true, name: true, role: true },
          });
          return { vendor, admin, provisioned };
        },
        { timeout: 30_000 },
      );
    } catch (e) {
      // A concurrent request can win the slug/email race between the checks above and here.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Vendor slug or admin email already exists');
      }
      throw e;
    }

    await this.audit.log({
      vendorId: created.vendor.id,
      userId: actor?.userId,
      userName: actor?.name,
      action: 'CREATE',
      entity: 'Vendor',
      entityId: created.vendor.id,
      changes: { after: { name: created.vendor.name, slug: created.vendor.slug, adminEmail } },
    });
    await this.audit.log({
      vendorId: created.vendor.id,
      userId: actor?.userId,
      userName: actor?.name,
      action: 'CREATE',
      entity: 'User',
      entityId: created.admin.id,
      changes: { after: { email: created.admin.email, name: created.admin.name, role: created.admin.role } },
    });

    await this.cache.invalidatePlatformDashboard();

    const { roleIdByKey: _roles, backfilledUserIds: _ids, ...summary } = created.provisioned;
    return { vendor: created.vendor, admin: created.admin, provisioning: { summary } };
  }

  /**
   * List vendors (SUPER_ADMIN list). Search / status / sort are applied in SQL; the per-vendor
   * customer and driver counts come from ONE groupBy each over the page's vendor ids (2 aggregate
   * queries per page regardless of page size). `sort=customers` is the expensive path: it counts
   * customers for every matching vendor first, then orders and slices in memory.
   */
  async findAllPaginated(query: ListVendorsQueryDto) {
    const { page = 1, limit = 20, search, status = 'all', sort = 'createdAt', order = 'desc' } = query;

    const where: Prisma.VendorWhereInput = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { users: { some: { role: UserRole.VENDOR_ADMIN, email: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    if (status === 'active') where.isActive = true;
    else if (status === 'suspended') where.isActive = false;
    else if (status === 'live') where.goLiveAt = { not: null };
    else if (status === 'not_live') where.goLiveAt = null;

    const include = {
      users: {
        where: { role: UserRole.VENDOR_ADMIN, isActive: true },
        select: { email: true },
        orderBy: { createdAt: 'asc' as const },
        take: 1,
      },
    };

    const total = await this.prisma.vendor.count({ where });
    let vendors: Array<Prisma.VendorGetPayload<{ include: typeof include }>>;
    let customerCounts: Map<string, number>;

    if (sort === 'customers') {
      const ids = (await this.prisma.vendor.findMany({ where, select: { id: true } })).map((v) => v.id);
      const grouped = ids.length
        ? await this.prisma.customer.groupBy({ by: ['vendorId'], where: { vendorId: { in: ids } }, _count: { _all: true } })
        : [];
      customerCounts = new Map(grouped.map((g) => [g.vendorId, g._count._all]));
      const dir = order === 'asc' ? 1 : -1;
      const pageIds = [...ids]
        .sort((a, b) => ((customerCounts.get(a) ?? 0) - (customerCounts.get(b) ?? 0)) * dir || a.localeCompare(b))
        .slice((page - 1) * limit, page * limit);
      const rows = pageIds.length ? await this.prisma.vendor.findMany({ where: { id: { in: pageIds } }, include }) : [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      vendors = pageIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
    } else {
      vendors = await this.prisma.vendor.findMany({
        where,
        include,
        orderBy: sort === 'name' ? { name: order } : { createdAt: order },
        skip: (page - 1) * limit,
        take: limit,
      });
      const ids = vendors.map((v) => v.id);
      const grouped = ids.length
        ? await this.prisma.customer.groupBy({ by: ['vendorId'], where: { vendorId: { in: ids } }, _count: { _all: true } })
        : [];
      customerCounts = new Map(grouped.map((g) => [g.vendorId, g._count._all]));
    }

    const pageIds = vendors.map((v) => v.id);
    const driverGroups = pageIds.length
      ? await this.prisma.user.groupBy({
          by: ['vendorId'],
          where: { vendorId: { in: pageIds }, role: UserRole.DRIVER, isActive: true },
          _count: { _all: true },
        })
      : [];
    const driverCounts = new Map(driverGroups.map((g) => [g.vendorId as string, g._count._all]));

    const data = vendors.map(({ users, ...v }) => ({
      ...v,
      adminEmail: users[0]?.email ?? null,
      _counts: { customers: customerCounts.get(v.id) ?? 0, drivers: driverCounts.get(v.id) ?? 0 },
    }));

    return paginate(data, total, page, limit);
  }

  /**
   * Vendor detail. Tenant scoping (defense-in-depth, beyond the route marker):
   * SUPER_ADMIN may read any vendor; a VENDOR_ADMIN may read ONLY their own vendor.
   */
  async findOne(id: string, caller?: AuthUser) {
    if (caller && caller.role !== UserRole.SUPER_ADMIN && caller.vendorId !== id) {
      throw new ForbiddenException('You can only access your own vendor.');
    }
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async update(id: string, dto: UpdateVendorDto, actor?: AuthUser) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of ['name', 'address', 'logoUrl', 'raastId'] as const) {
      if (dto[key] !== undefined && dto[key] !== vendor[key]) {
        before[key] = vendor[key];
        after[key] = dto[key];
      }
    }
    if (!Object.keys(after).length) return vendor;

    const updated = await this.prisma.vendor.update({ where: { id }, data: after });
    await this.audit.log({
      vendorId: id,
      userId: actor?.userId,
      userName: actor?.name,
      action: 'UPDATE',
      entity: 'Vendor',
      entityId: id,
      changes: { before, after },
    });
    return updated;
  }

  /** Suspend vendor — blocks all their users from authenticating via Redis flag */
  async suspend(id: string, actor?: AuthUser, reason?: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (!vendor.isActive) throw new ConflictException('Vendor is already suspended');

    await this.prisma.vendor.update({ where: { id }, data: { isActive: false } });

    // Set Redis flag — JwtStrategy checks this on every request (fast cache lookup)
    // No TTL — stays until explicitly unsuspended
    await this.cache.set(vendorSuspendedKey(id), true, 0);
    await this.cache.invalidatePlatformDashboard();

    await this.audit.log({
      vendorId: id,
      userId: actor?.userId,
      userName: actor?.name,
      action: 'SUSPEND',
      entity: 'Vendor',
      entityId: id,
      changes: { before: { isActive: true }, after: { isActive: false }, reason },
    });

    return { message: `Vendor "${vendor.name}" suspended successfully` };
  }

  /** Unsuspend vendor — restores access */
  async unsuspend(id: string, actor?: AuthUser, reason?: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (vendor.isActive) throw new ConflictException('Vendor is not suspended');

    await this.prisma.vendor.update({ where: { id }, data: { isActive: true } });
    await this.cache.del(vendorSuspendedKey(id));
    await this.cache.invalidatePlatformDashboard();

    await this.audit.log({
      vendorId: id,
      userId: actor?.userId,
      userName: actor?.name,
      action: 'UNSUSPEND',
      entity: 'Vendor',
      entityId: id,
      changes: { before: { isActive: false }, after: { isActive: true }, reason },
    });

    return { message: `Vendor "${vendor.name}" unsuspended successfully` };
  }

  /**
   * Bulk suspend / unsuspend (max 25, validated by the DTO). Every id goes through the single-vendor
   * path (DB flag + Redis flag + audit with actor); failures are reported per id, never thrown.
   * Protected (legacy / production) vendors are never touched. There is deliberately no bulk delete.
   */
  async bulkSetSuspended(action: 'suspend' | 'unsuspend', vendorIds: string[], actor?: AuthUser, reason?: string) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of vendorIds) {
      if (isLegacyVendor(id)) {
        results.push({ id, ok: false, error: 'Protected vendor: cannot be changed in bulk' });
        continue;
      }
      try {
        if (action === 'suspend') await this.suspend(id, actor, reason);
        else await this.unsuspend(id, actor, reason);
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: (e as Error).message });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    return { results, succeeded, failed: results.length - succeeded };
  }

  /** Delete vendor — only allowed if no transactions exist */
  async remove(id: string, actor?: AuthUser) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
      include: {
        _count: {
          select: { transactions: true, customers: true },
        },
      },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    if (vendor._count.transactions > 0) {
      throw new BadRequestException(
        `Cannot delete vendor — ${vendor._count.transactions} transaction(s) exist. Suspend instead.`,
      );
    }

    // Real business records authored by this vendor's staff reference users with
    // ON DELETE RESTRICT, so deleting the users would fail (previously a bare 500).
    // Refuse up front with a clear list instead of cascade-deleting business data.
    const blockers = await this.findDeleteBlockers(id);
    if (blockers.length > 0) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: `Cannot delete vendor — it has business records that must be kept: ${blockers
          .map((b) => `${b.entity} (${b.count})`)
          .join(', ')}. Suspend the vendor instead, or use the wipe flow.`,
        blockers,
      });
    }

    // Delete all related data in order (Prisma cascade may not cover all)
    try {
    await this.prisma['$transaction'](async (tx: any) => {
      await tx.dailySheetItem.deleteMany({ where: { dailySheet: { vendorId: id } } });
      await tx.dailySheet.deleteMany({ where: { vendorId: id } });
      await tx.bottleWallet.deleteMany({ where: { customer: { vendorId: id } } });
      await tx.customerProductPrice.deleteMany({ where: { customer: { vendorId: id } } });
      await tx.customer.deleteMany({ where: { vendorId: id } });
      await tx.van.deleteMany({ where: { vendorId: id } });
      await tx.route.deleteMany({ where: { vendorId: id } });
      await tx.product.deleteMany({ where: { vendorId: id } });
      // Seeded by provisioning at creation; FK is RESTRICT (no cascade), so a brand-new vendor
      // could otherwise never be deleted.
      await tx.customerFlagCategory.deleteMany({ where: { vendorId: id } });
      await tx.user.deleteMany({ where: { vendorId: id } });
      await tx.vendor.delete({ where: { id } });
    });
    } catch (err) {
      // Safety net for FK-protected rows not covered by findDeleteBlockers: the transaction
      // is rolled back, so nothing is half-deleted. Report as 409, never a raw 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        const constraint = String((err.meta as any)?.constraint ?? (err.meta as any)?.field_name ?? 'foreign key');
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: `Cannot delete vendor — other records still reference it (${constraint}). Suspend the vendor instead, or use the wipe flow.`,
          blockers: [{ entity: constraint, count: null }],
        });
      }
      throw err;
    }

    await this.cache.del(vendorSuspendedKey(id));
    await this.cache.invalidatePlatformDashboard();

    await this.audit.log({
      userId: actor?.userId,
      userName: actor?.name,
      action: 'DELETE',
      entity: 'Vendor',
      entityId: id,
      changes: { before: { name: vendor.name } },
    });

    return { message: 'Vendor and all associated data deleted permanently' };
  }

  /** Vendor-scoped business models whose rows reference users with RESTRICT FKs. */
  private static readonly DELETE_BLOCKER_MODELS = [
    'expense', 'extraLabour', 'crewCashDistribution', 'damageCase', 'sheetDiscrepancyCase',
    'conversationMessage', 'salaryStructure', 'productCost', 'staffLedgerEntry', 'staffAdvancePlan',
    'payrollEntry', 'settlement', 'staffAttendance', 'vehicleDocument', 'vehicleDailyCheck',
    'fuelLog', 'fuelCard', 'standaloneCrewCashExpense', 'sheetAdvance', 'vehicleServiceRecord',
    'vanCashHandover', 'officeCashRemittance', 'customerFinancialAdjustment', 'customerDepositEntry',
  ] as const;

  private async findDeleteBlockers(vendorId: string): Promise<{ entity: string; count: number }[]> {
    const db = this.prisma as any;
    const counts = await Promise.all(
      VendorService.DELETE_BLOCKER_MODELS.map(async (model) => ({
        entity: model,
        count: (await db[model]?.count?.({ where: { vendorId } })) ?? 0,
      })),
    );
    return counts.filter((c) => c.count > 0);
  }

  /** Detailed stats for a single vendor — used in SUPER_ADMIN vendor detail view */
  async getStats(id: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalCustomers,
      totalDrivers,
      totalRoutes,
      totalVans,
      totalUsers,
      customerUsers,
      activeUsers,
      revenueAgg,
      revenueMonthAgg,
      outstandingAgg,
      deliveriesThisMonth,
      sheetsThisMonth,
      lastSheet,
    ] = await Promise.all([
      this.prisma.customer.count({ where: { vendorId: id } }),
      this.prisma.user.count({ where: { vendorId: id, role: UserRole.DRIVER, isActive: true } }),
      this.prisma.route.count({ where: { vendorId: id } }),
      this.prisma.van.count({ where: { vendorId: id } }),
      this.prisma.user.count({ where: { vendorId: id } }),
      this.prisma.user.count({ where: { vendorId: id, role: UserRole.CUSTOMER } }),
      this.prisma.user.count({ where: { vendorId: id, isActive: true } }),
      this.prisma.transaction.aggregate({
        where: { vendorId: id, type: 'DELIVERY' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { vendorId: id, type: 'DELIVERY', createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.prisma.customer.aggregate({
        where: { vendorId: id },
        _sum: { financialBalance: true },
      }),
      this.prisma.dailySheetItem.count({
        where: {
          status: 'COMPLETED',
          dailySheet: { vendorId: id, date: { gte: startOfMonth } },
        },
      }),
      this.prisma.dailySheet.count({
        where: { vendorId: id, date: { gte: startOfMonth } },
      }),
      this.prisma.dailySheet.findFirst({
        where: { vendorId: id },
        orderBy: { date: 'desc' },
        select: { date: true },
      }),
    ]);

    return {
      vendor,
      stats: {
        totalCustomers,
        totalDrivers,
        totalRoutes,
        totalVans,
        totalUsers,
        customerUsers,
        activeUsers,
        inactiveUsers: totalUsers - activeUsers,
        totalRevenue: revenueAgg._sum.amount ?? 0,
        revenueThisMonth: revenueMonthAgg._sum.amount ?? 0,
        outstandingBalance: outstandingAgg._sum.financialBalance ?? 0,
        deliveriesThisMonth,
        sheetsThisMonth,
        lastActiveDate: lastSheet?.date ?? null,
      },
    };
  }

  /** Paginated users of a vendor (SUPER_ADMIN oversight). CUSTOMER-role users are excluded unless asked for. */
  async findVendorUsers(id: string, query: VendorUsersQueryDto = {}) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id }, select: { id: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const { page = 1, limit = 20, role, search, isActive } = query;
    const where: Prisma.UserWhereInput = {
      vendorId: id,
      role: role ? (role as UserRole) : { not: UserRole.CUSTOMER },
    };
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search } },
      ];
    }

    const [rows, total, roleGroups] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          phoneNumber: true,
          isActive: true,
          createdAt: true,
          roleRef: { select: { name: true } },
        },
        orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.groupBy({ by: ['role'], where: { vendorId: id }, _count: { _all: true } }),
    ]);

    const data = rows.map(({ roleRef, ...u }) => ({ ...u, roleName: roleRef?.name ?? null }));
    const result = paginate(data, total, page, limit);
    const roleCounts = Object.fromEntries(roleGroups.map((g) => [g.role, g._count._all]));
    return { ...result, meta: { ...result.meta, roleCounts } };
  }

  /**
   * Force-reset a vendor admin's password — SUPER_ADMIN support tool. Requires the calling super
   * admin's own password (re-auth, same as wipe), revokes the target's existing sessions and audits
   * the action. No password material is ever written to the audit log.
   */
  async resetAdminPassword(vendorId: string, dto: ResetAdminPasswordDto, actor: AuthUser) {
    const me = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { password: true, role: true } });
    if (!me?.password || me.role !== UserRole.SUPER_ADMIN || !(await bcrypt.compare(dto.superAdminPassword, me.password))) {
      throw new ForbiddenException('Incorrect password.');
    }

    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    let admin: { id: string; email: string; name: string | null };
    if (dto.adminUserId) {
      const found = await this.prisma.user.findFirst({
        where: { id: dto.adminUserId, vendorId, role: UserRole.VENDOR_ADMIN },
        select: { id: true, email: true, name: true },
      });
      if (!found) throw new NotFoundException('VENDOR_ADMIN not found for this vendor');
      admin = found;
    } else {
      const admins = await this.prisma.user.findMany({
        where: { vendorId, role: UserRole.VENDOR_ADMIN, isActive: true },
        select: { id: true, email: true, name: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!admins.length) throw new NotFoundException('Active VENDOR_ADMIN not found for this vendor');
      if (admins.length > 1) {
        throw new ConflictException({
          message: 'This vendor has several admins. Choose which one to reset.',
          admins: admins.map((a) => ({ id: a.id, email: a.email, name: a.name })),
        });
      }
      admin = admins[0];
    }

    const hashed = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: admin.id }, data: { password: hashed } });
    if (!this.auth) throw new Error('AuthService not available: cannot revoke sessions');
    await this.auth.revokeUserSessions(admin.id);

    await this.audit.log({
      vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: 'RESET_ADMIN_PASSWORD',
      entity: 'User',
      entityId: admin.id,
      changes: { after: { email: admin.email, sessionsRevoked: true }, reason: dto.reason },
    });

    return { message: `Admin password reset for ${admin.email}`, userId: admin.id, email: admin.email, sessionsRevoked: true };
  }
}
