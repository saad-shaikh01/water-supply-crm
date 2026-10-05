import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
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

// Redis key used to block suspended vendor's users from authenticating
export const vendorSuspendedKey = (vendorId: string) =>
  `vendor:${vendorId}:suspended`;

@Injectable()
export class VendorService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
    private audit: AuditService,
    private provisioning: VendorProvisioningService,
  ) {}

  /**
   * Create a vendor, provision it (system roles, starter catalogues) and create its
   * VENDOR_ADMIN — all in ONE transaction, every write on `tx`. Anything that fails
   * (including a duplicate admin email) rolls the whole vendor back, so a half-built
   * vendor with no usable admin can never be left behind.
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

    let created;
    try {
      created = await this.prisma.$transaction(
        async (tx) => {
          const vendor = await tx.vendor.create({ data: vendorData });
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
          return { vendor, admin };
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

    return created.vendor;
  }

  /** List all vendors with pagination — used by SUPER_ADMIN dashboard list */
  async findAllPaginated(query: any) {
    const { page = 1, limit = 20 } = query;

    const [vendors, total] = await Promise.all([
      this.prisma.vendor.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vendor.count(),
    ]);

    // Attach quick counts to each vendor
    const withCounts = await Promise.all(
      vendors.map(async (v) => {
        const [customers, drivers] = await Promise.all([
          this.prisma.customer.count({ where: { vendorId: v.id } }),
          this.prisma.user.count({
            where: { vendorId: v.id, role: UserRole.DRIVER, isActive: true },
          }),
        ]);
        return { ...v, _counts: { customers, drivers } };
      }),
    );

    return paginate(withCounts, total, page, limit);
  }

  async findAll() {
    const vendors = await this.prisma.vendor.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const withCounts = await Promise.all(
      vendors.map(async (v) => {
        const [customers, drivers] = await Promise.all([
          this.prisma.customer.count({ where: { vendorId: v.id } }),
          this.prisma.user.count({
            where: { vendorId: v.id, role: UserRole.DRIVER, isActive: true },
          }),
        ]);
        return { ...v, _counts: { customers, drivers } };
      }),
    );

    return withCounts;
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

  async update(id: string, dto: UpdateVendorDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return this.prisma.vendor.update({ where: { id }, data: dto });
  }

  /** Suspend vendor — blocks all their users from authenticating via Redis flag */
  async suspend(id: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (!vendor.isActive) throw new ConflictException('Vendor is already suspended');

    await this.prisma.vendor.update({ where: { id }, data: { isActive: false } });

    // Set Redis flag — JwtStrategy checks this on every request (fast cache lookup)
    // No TTL — stays until explicitly unsuspended
    await this.cache.set(vendorSuspendedKey(id), true, 0);

    await this.audit.log({
      vendorId: id,
      action: 'SUSPEND',
      entity: 'Vendor',
      entityId: id,
    });

    return { message: `Vendor "${vendor.name}" suspended successfully` };
  }

  /** Unsuspend vendor — restores access */
  async unsuspend(id: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (vendor.isActive) throw new ConflictException('Vendor is not suspended');

    await this.prisma.vendor.update({ where: { id }, data: { isActive: true } });
    await this.cache.del(vendorSuspendedKey(id));

    await this.audit.log({
      vendorId: id,
      action: 'UNSUSPEND',
      entity: 'Vendor',
      entityId: id,
    });

    return { message: `Vendor "${vendor.name}" unsuspended successfully` };
  }

  /** Delete vendor — only allowed if no transactions exist */
  async remove(id: string) {
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

    // Delete all related data in order (Prisma cascade may not cover all)
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

    await this.cache.del(vendorSuspendedKey(id));

    await this.audit.log({
      action: 'DELETE',
      entity: 'Vendor',
      entityId: id,
      changes: { before: { name: vendor.name } },
    });

    return { message: 'Vendor and all associated data deleted permanently' };
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
      revenueAgg,
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
      this.prisma.transaction.aggregate({
        where: { vendorId: id, type: 'DELIVERY' },
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
        totalRevenue: revenueAgg._sum.amount ?? 0,
        outstandingBalance: outstandingAgg._sum.financialBalance ?? 0,
        deliveriesThisMonth,
        sheetsThisMonth,
        lastActiveDate: lastSheet?.date ?? null,
      },
    };
  }

  /** List all users belonging to a vendor — SUPER_ADMIN oversight */
  async findVendorUsers(id: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    return this.prisma.user.findMany({
      where: { vendorId: id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phoneNumber: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { role: 'asc' },
    });
  }

  /** Force-reset a vendor admin's password — SUPER_ADMIN support tool */
  async resetAdminPassword(vendorId: string, newPassword: string) {
    const admin = await this.prisma.user.findFirst({
      where: { vendorId, role: UserRole.VENDOR_ADMIN, isActive: true },
    });
    if (!admin) {
      throw new NotFoundException('Active VENDOR_ADMIN not found for this vendor');
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: admin.id },
      data: { password: hashed },
    });

    return { message: `Admin password reset for ${admin.email}` };
  }
}
