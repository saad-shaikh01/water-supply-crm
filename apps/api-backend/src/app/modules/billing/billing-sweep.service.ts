import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { AuditService } from '../audit/audit.service';
import { VendorService } from '../vendor/vendor.service';
import { addDays, addInterval } from './billing.util';
import { InvoiceService } from './invoice.service';
import { PlanLimitService } from './plan-limit.service';

export interface BillingSweepOptions {
  autoSuspend: boolean;
  graceDays: number;
  /** Generate renewal invoices this many days before period end (D7). */
  renewalLeadDays: number;
}

export interface BillingSweepResult {
  trialsExpired: number;
  periodsLapsed: number;
  freeRolledForward: number;
  suspended: number;
  renewalInvoices: number;
}

export function billingOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): BillingSweepOptions {
  const grace = parseInt(env.BILLING_GRACE_DAYS ?? '7', 10);
  return {
    autoSuspend: env.BILLING_AUTO_SUSPEND === 'true', // D2: OFF by default
    graceDays: Number.isFinite(grace) && grace >= 0 ? grace : 7,
    renewalLeadDays: 7,
  };
}

@Injectable()
export class BillingSweepService {
  private readonly logger = new Logger(BillingSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly vendors: VendorService,
    private readonly invoices: InvoiceService,
    private readonly planLimits: PlanLimitService,
  ) {}

  /** Pure-ish and idempotent: every step is keyed on current state, so re-running changes nothing. */
  async runBillingSweep(now = new Date(), options: BillingSweepOptions = billingOptionsFromEnv()): Promise<BillingSweepResult> {
    const result: BillingSweepResult = { trialsExpired: 0, periodsLapsed: 0, freeRolledForward: 0, suspended: 0, renewalInvoices: 0 };
    const touched = new Set<string>();

    // 1. Expired trials -> PAST_DUE (D8)
    const trials = await this.prisma.vendorSubscription.findMany({
      where: { status: 'TRIAL', trialEndsAt: { lt: now } },
      select: { id: true, vendorId: true },
    });
    for (const s of trials) {
      const { count } = await this.prisma.vendorSubscription.updateMany({
        where: { id: s.id, status: 'TRIAL' },
        data: { status: 'PAST_DUE', pastDueSince: now },
      });
      if (!count) continue;
      result.trialsExpired++;
      touched.add(s.vendorId);
      await this.audit.log({
        vendorId: s.vendorId,
        userName: 'system',
        action: 'SUBSCRIPTION_PAST_DUE',
        entity: 'VendorSubscription',
        entityId: s.id,
        changes: { before: { status: 'TRIAL' }, after: { status: 'PAST_DUE' }, reason: 'Trial ended' },
      });
    }

    // 2. ACTIVE with a lapsed period and no PAID invoice covering it -> PAST_DUE
    const lapsed = await this.prisma.vendorSubscription.findMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { lt: now } },
      include: { plan: true },
    });
    for (const s of lapsed) {
      if (s.plan.price.lte(0)) {
        // A free plan has nothing to pay: roll the period forward instead of flagging it past due.
        let start = s.currentPeriodEnd;
        let end = addInterval(start, s.plan.interval);
        while (end <= now) {
          start = end;
          end = addInterval(start, s.plan.interval);
        }
        await this.prisma.vendorSubscription.update({
          where: { id: s.id },
          data: { currentPeriodStart: start, currentPeriodEnd: end },
        });
        result.freeRolledForward++;
        continue;
      }
      const covered = await this.prisma.invoice.findFirst({
        where: { subscriptionId: s.id, status: 'PAID', periodEnd: { gte: now } },
        select: { id: true },
      });
      if (covered) continue;
      const { count } = await this.prisma.vendorSubscription.updateMany({
        where: { id: s.id, status: 'ACTIVE' },
        data: { status: 'PAST_DUE', pastDueSince: now },
      });
      if (!count) continue;
      result.periodsLapsed++;
      touched.add(s.vendorId);
      await this.audit.log({
        vendorId: s.vendorId,
        userName: 'system',
        action: 'SUBSCRIPTION_PAST_DUE',
        entity: 'VendorSubscription',
        entityId: s.id,
        changes: { before: { status: 'ACTIVE' }, after: { status: 'PAST_DUE' }, reason: 'Billing period ended without payment' },
      });
    }

    // 3. Optional auto-suspension after the grace period (never touches manual suspensions)
    if (options.autoSuspend) {
      const cutoff = addDays(now, -options.graceDays);
      const overdue = await this.prisma.vendorSubscription.findMany({
        where: {
          status: 'PAST_DUE',
          pastDueSince: { lte: cutoff },
          suspendedByBilling: false,
          vendor: { isActive: true }, // already-suspended (manual) vendors are left alone
        },
        select: { id: true, vendorId: true },
      });
      for (const s of overdue) {
        try {
          await this.vendors.suspend(s.vendorId);
        } catch (e) {
          this.logger.warn(`Billing auto-suspend of vendor ${s.vendorId} failed: ${(e as Error).message}`);
          continue;
        }
        await this.prisma.vendorSubscription.update({ where: { id: s.id }, data: { suspendedByBilling: true } });
        result.suspended++;
        touched.add(s.vendorId);
        await this.audit.log({
          vendorId: s.vendorId,
          userName: 'system',
          action: 'BILLING_AUTO_SUSPEND',
          entity: 'Vendor',
          entityId: s.vendorId,
          changes: { reason: `Past due for more than ${options.graceDays} day(s)` },
        });
      }
    }

    // 4. Renewal invoices (D7), idempotent via @@unique([subscriptionId, periodStart])
    const renewals = await this.prisma.vendorSubscription.findMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { lte: addDays(now, options.renewalLeadDays) } },
      include: { plan: true },
    });
    for (const s of renewals) {
      if (s.plan.price.lte(0)) continue;
      const created = await this.invoices.createRenewalInvoice(s);
      if (created) result.renewalInvoices++;
    }

    await Promise.all([...touched].map((v) => this.planLimits.invalidate(v)));
    this.logger.log(`Billing sweep done: ${JSON.stringify(result)}`);
    return result;
  }
}
