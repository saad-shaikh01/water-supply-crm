import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../../common/helpers/paginate';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { addDays, addInterval } from './billing.util';
import { PlanLimitService } from './plan-limit.service';
import { AssignSubscriptionDto, CancelSubscriptionDto, ListSubscriptionsQueryDto } from './dto/subscription.dto';

type Usage = { customers: number; drivers: number; vans: number };
type Limits = { maxCustomers: number | null; maxDrivers: number | null; maxVans: number | null };

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly planLimits: PlanLimitService,
  ) {}

  static effectiveLimits(sub: {
    plan: { maxCustomers: number | null; maxDrivers: number | null; maxVans: number | null };
    overrideMaxCustomers: number | null;
    overrideMaxDrivers: number | null;
    overrideMaxVans: number | null;
  }): Limits {
    return {
      maxCustomers: sub.overrideMaxCustomers ?? sub.plan.maxCustomers,
      maxDrivers: sub.overrideMaxDrivers ?? sub.plan.maxDrivers,
      maxVans: sub.overrideMaxVans ?? sub.plan.maxVans,
    };
  }

  private exceeds(limits: Limits, usage: Usage): boolean {
    return (
      (limits.maxCustomers != null && usage.customers > limits.maxCustomers) ||
      (limits.maxDrivers != null && usage.drivers > limits.maxDrivers) ||
      (limits.maxVans != null && usage.vans > limits.maxVans)
    );
  }

  async list(query: ListSubscriptionsQueryDto) {
    const { page = 1, limit = 20, status, planId, q } = query;
    const where: Prisma.VendorSubscriptionWhereInput = {
      ...(status ? { status } : {}),
      ...(planId ? { planId } : {}),
      ...(q ? { vendor: { name: { contains: q, mode: 'insensitive' } } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.vendorSubscription.findMany({
        where,
        include: { plan: true, vendor: { select: { id: true, name: true } } },
        orderBy: [{ currentPeriodEnd: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vendorSubscription.count({ where }),
    ]);

    const vendorIds = rows.map((r) => r.vendorId);
    const usageByVendor = await this.usageForVendors(vendorIds);

    const data = rows.map((s) => ({
      vendor: s.vendor,
      plan: s.plan,
      status: s.status,
      trialEndsAt: s.trialEndsAt,
      currentPeriodEnd: s.currentPeriodEnd,
      usage: usageByVendor.get(s.vendorId) ?? { customers: 0, drivers: 0, vans: 0 },
      limits: SubscriptionService.effectiveLimits(s),
    }));
    return paginate(data, total, page, limit);
  }

  /** Batched usage (3 grouped queries for the whole page, not 3 per vendor). */
  private async usageForVendors(vendorIds: string[]): Promise<Map<string, Usage>> {
    const map = new Map<string, Usage>(vendorIds.map((id) => [id, { customers: 0, drivers: 0, vans: 0 }]));
    if (!vendorIds.length) return map;
    const [customers, drivers, vans] = await Promise.all([
      this.prisma.customer.groupBy({ by: ['vendorId'], where: { vendorId: { in: vendorIds }, isActive: true }, _count: { _all: true } }),
      this.prisma.user.groupBy({
        by: ['vendorId'],
        where: { vendorId: { in: vendorIds }, role: 'DRIVER', isActive: true, isSystem: false },
        _count: { _all: true },
      }),
      this.prisma.van.groupBy({ by: ['vendorId'], where: { vendorId: { in: vendorIds }, isActive: true }, _count: { _all: true } }),
    ]);
    for (const r of customers) if (r.vendorId) map.get(r.vendorId)!.customers = r._count._all;
    for (const r of drivers) if (r.vendorId) map.get(r.vendorId)!.drivers = r._count._all;
    for (const r of vans) if (r.vendorId) map.get(r.vendorId)!.vans = r._count._all;
    return map;
  }

  async getForVendor(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    const [subscription, usage, recentInvoices] = await Promise.all([
      this.prisma.vendorSubscription.findUnique({ where: { vendorId }, include: { plan: true } }),
      this.planLimits.getUsage(vendorId),
      this.prisma.invoice.findMany({ where: { vendorId }, orderBy: { issuedAt: 'desc' }, take: 5 }),
    ]);
    return {
      subscription,
      limits: subscription ? SubscriptionService.effectiveLimits(subscription) : null, // null = unlimited
      usage,
      recentInvoices,
    };
  }

  /** PUT upsert: exactly one current subscription per vendor. Downgrades below usage warn, never delete. */
  async assign(vendorId: string, dto: AssignSubscriptionDto, actor: AuthUser, now = new Date()) {
    const [vendor, plan, existing] = await Promise.all([
      this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true } }),
      this.prisma.plan.findUnique({ where: { id: dto.planId } }),
      this.prisma.vendorSubscription.findUnique({ where: { vendorId } }),
    ]);
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.isActive && existing?.planId !== plan.id) {
      throw new BadRequestException('This plan is inactive and cannot be newly assigned');
    }

    const start = dto.periodStart ? new Date(dto.periodStart) : now;
    const trialDays = dto.trialDays ?? plan.trialDays;
    const trial = (dto.startTrial ?? !existing) && trialDays > 0;

    const overrideData: Prisma.VendorSubscriptionUncheckedUpdateInput = {};
    if (dto.overrides) {
      if ('maxCustomers' in dto.overrides) overrideData.overrideMaxCustomers = dto.overrides.maxCustomers ?? null;
      if ('maxDrivers' in dto.overrides) overrideData.overrideMaxDrivers = dto.overrides.maxDrivers ?? null;
      if ('maxVans' in dto.overrides) overrideData.overrideMaxVans = dto.overrides.maxVans ?? null;
    }

    let subscription;
    if (!existing) {
      const trialEndsAt = trial ? addDays(start, trialDays) : null;
      subscription = await this.prisma.vendorSubscription.create({
        data: {
          vendorId,
          planId: plan.id,
          status: trial ? 'TRIAL' : 'ACTIVE',
          trialEndsAt,
          currentPeriodStart: start,
          currentPeriodEnd: trialEndsAt ?? addInterval(start, plan.interval),
          notes: dto.notes,
          createdById: actor.userId,
          overrideMaxCustomers: (overrideData.overrideMaxCustomers as number | null | undefined) ?? null,
          overrideMaxDrivers: (overrideData.overrideMaxDrivers as number | null | undefined) ?? null,
          overrideMaxVans: (overrideData.overrideMaxVans as number | null | undefined) ?? null,
        },
        include: { plan: true },
      });
    } else {
      const data: Prisma.VendorSubscriptionUncheckedUpdateInput = {
        planId: plan.id,
        ...overrideData,
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      };
      if (dto.startTrial === true && trialDays > 0) {
        const trialEndsAt = addDays(start, trialDays);
        Object.assign(data, {
          status: 'TRIAL',
          trialEndsAt,
          currentPeriodStart: start,
          currentPeriodEnd: trialEndsAt,
          pastDueSince: null,
        });
      } else if (dto.periodStart) {
        Object.assign(data, { currentPeriodStart: start, currentPeriodEnd: addInterval(start, plan.interval) });
      }
      subscription = await this.prisma.vendorSubscription.update({
        where: { vendorId },
        data,
        include: { plan: true },
      });
    }

    await this.planLimits.invalidate(vendorId);

    const limits = SubscriptionService.effectiveLimits(subscription);
    const usage = await this.planLimits.getUsage(vendorId);
    const warnings = this.exceeds(limits, usage) ? ['USAGE_EXCEEDS_LIMIT'] : [];

    await this.audit.log({
      vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: existing ? 'SUBSCRIPTION_CHANGE' : 'SUBSCRIPTION_ASSIGN',
      entity: 'VendorSubscription',
      entityId: subscription.id,
      changes: {
        before: existing ? { planId: existing.planId, status: existing.status } : undefined,
        after: { planId: plan.id, planName: plan.name, status: subscription.status, overrides: dto.overrides, warnings },
      },
    });

    return { subscription, limits, usage, warnings };
  }

  async cancel(vendorId: string, dto: CancelSubscriptionDto, actor: AuthUser, now = new Date()) {
    const sub = await this.prisma.vendorSubscription.findUnique({ where: { vendorId } });
    if (!sub) throw new NotFoundException('Vendor has no subscription');
    if (sub.status === 'CANCELLED') throw new ConflictException('Subscription is already cancelled');

    const updated = await this.prisma.vendorSubscription.update({
      where: { vendorId },
      data: { status: 'CANCELLED', cancelledAt: now, cancelReason: dto.reason, pastDueSince: null },
      include: { plan: true },
    });
    await this.planLimits.invalidate(vendorId);
    await this.audit.log({
      vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: 'SUBSCRIPTION_CANCEL',
      entity: 'VendorSubscription',
      entityId: sub.id,
      changes: { before: { status: sub.status }, after: { status: 'CANCELLED' }, reason: dto.reason },
    });
    return updated;
  }

  /** CANCELLED -> ACTIVE with a fresh period starting now. */
  async reactivate(vendorId: string, actor: AuthUser, now = new Date()) {
    const sub = await this.prisma.vendorSubscription.findUnique({ where: { vendorId }, include: { plan: true } });
    if (!sub) throw new NotFoundException('Vendor has no subscription');
    if (sub.status !== 'CANCELLED') throw new ConflictException('Only a cancelled subscription can be reactivated');

    const updated = await this.prisma.vendorSubscription.update({
      where: { vendorId },
      data: {
        status: 'ACTIVE',
        cancelledAt: null,
        cancelReason: null,
        pastDueSince: null,
        currentPeriodStart: now,
        currentPeriodEnd: addInterval(now, sub.plan.interval),
      },
      include: { plan: true },
    });
    await this.planLimits.invalidate(vendorId);
    await this.audit.log({
      vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: 'SUBSCRIPTION_REACTIVATE',
      entity: 'VendorSubscription',
      entityId: sub.id,
      changes: { before: { status: sub.status }, after: { status: 'ACTIVE' } },
    });
    return updated;
  }

  /** Vendor self-view (tenant from token). */
  async getMine(vendorId: string) {
    const [sub, usage, openInvoices] = await Promise.all([
      this.prisma.vendorSubscription.findUnique({ where: { vendorId }, include: { plan: true } }),
      this.planLimits.getUsage(vendorId),
      this.prisma.invoice.findMany({
        where: { vendorId, status: 'OPEN' },
        orderBy: { dueAt: 'asc' },
        select: { number: true, amount: true, dueAt: true },
      }),
    ]);
    if (!sub) {
      return { plan: null, status: null, trialEndsAt: null, currentPeriodEnd: null, limits: null, usage, openInvoices };
    }
    return {
      plan: { name: sub.plan.name, interval: sub.plan.interval },
      status: sub.status,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      limits: SubscriptionService.effectiveLimits(sub),
      usage,
      openInvoices,
    };
  }

  async getMyInvoices(vendorId: string, query: PaginationQueryDto) {
    const { page = 1, limit = 20 } = query;
    const where: Prisma.InvoiceWhereInput = { vendorId, status: { not: 'DRAFT' } };
    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({ where, orderBy: { issuedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.invoice.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }
}
