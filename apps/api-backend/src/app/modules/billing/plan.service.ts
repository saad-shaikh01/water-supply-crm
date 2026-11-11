import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { PlanLimitService } from './plan-limit.service';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';

@Injectable()
export class PlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly planLimits: PlanLimitService,
  ) {}

  findAll(includeInactive = false) {
    return this.prisma.plan.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { subscriptions: true } } },
    });
  }

  async create(dto: CreatePlanDto, actor: AuthUser) {
    const { features, ...rest } = dto;
    let plan;
    try {
      plan = await this.prisma.plan.create({
        data: { ...rest, ...(features ? { features: features as Prisma.InputJsonValue } : {}) },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A plan named "${dto.name}" already exists`);
      }
      throw e;
    }
    await this.audit.log({
      userId: actor.userId,
      userName: actor.name,
      action: 'CREATE',
      entity: 'Plan',
      entityId: plan.id,
      changes: { after: dto },
    });
    return plan;
  }

  /** Limit decreases never delete data; `affectedVendors` = vendors now over a limit (warning only). */
  async update(id: string, dto: UpdatePlanDto, actor: AuthUser) {
    const before = await this.prisma.plan.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Plan not found');

    const { features, ...rest } = dto;
    let plan;
    try {
      plan = await this.prisma.plan.update({
        where: { id },
        data: { ...rest, ...(features ? { features: features as Prisma.InputJsonValue } : {}) },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A plan named "${dto.name}" already exists`);
      }
      throw e;
    }

    const subs = await this.prisma.vendorSubscription.findMany({ where: { planId: id }, select: { vendorId: true } });
    await Promise.all(subs.map((s) => this.planLimits.invalidate(s.vendorId)));
    const affectedVendors = await this.countAffectedVendors(id);

    await this.audit.log({
      userId: actor.userId,
      userName: actor.name,
      action: 'UPDATE',
      entity: 'Plan',
      entityId: id,
      changes: { before, after: plan },
    });
    return { ...plan, affectedVendors };
  }

  async remove(id: string, actor: AuthUser) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan._count.subscriptions > 0) {
      throw new ConflictException(
        `Plan is used by ${plan._count.subscriptions} subscription(s). Deactivate it instead of deleting.`,
      );
    }
    await this.prisma.plan.delete({ where: { id } });
    await this.audit.log({
      userId: actor.userId,
      userName: actor.name,
      action: 'DELETE',
      entity: 'Plan',
      entityId: id,
      changes: { before: plan },
    });
    return { message: 'Plan deleted' };
  }

  /** Vendors on this plan whose usage now exceeds a (plan or overridden) limit. */
  private async countAffectedVendors(planId: string): Promise<number> {
    const subs = await this.prisma.vendorSubscription.findMany({
      where: { planId },
      include: { plan: true },
    });
    let affected = 0;
    for (const s of subs) {
      const limits = {
        customers: s.overrideMaxCustomers ?? s.plan.maxCustomers,
        drivers: s.overrideMaxDrivers ?? s.plan.maxDrivers,
        vans: s.overrideMaxVans ?? s.plan.maxVans,
      };
      if (limits.customers == null && limits.drivers == null && limits.vans == null) continue;
      const usage = await this.planLimits.getUsage(s.vendorId);
      if (
        (limits.customers != null && usage.customers > limits.customers) ||
        (limits.drivers != null && usage.drivers > limits.drivers) ||
        (limits.vans != null && usage.vans > limits.vans)
      ) {
        affected++;
      }
    }
    return affected;
  }
}
