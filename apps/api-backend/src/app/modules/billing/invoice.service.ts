import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { VendorService } from '../vendor/vendor.service';
import { paginate } from '../../common/helpers/paginate';
import { addInterval } from './billing.util';
import { PlanLimitService } from './plan-limit.service';
import {
  CreateInvoiceDto,
  ListInvoicesQueryDto,
  RecordPaymentDto,
  UpdateInvoiceDto,
  VoidInvoiceDto,
} from './dto/invoice.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly vendors: VendorService,
    private readonly planLimits: PlanLimitService,
  ) {}

  /** INV-YYYY-000123 from the admin_p4_invoice_seq sequence (gapless-ish, never reused). */
  async nextNumber(db: Prisma.TransactionClient | PrismaService = this.prisma, now = new Date()): Promise<string> {
    const rows = await db.$queryRaw<{ n: bigint }[]>`SELECT nextval('admin_p4_invoice_seq') AS n`;
    return `INV-${now.getUTCFullYear()}-${String(rows[0].n).padStart(6, '0')}`;
  }

  async list(query: ListInvoicesQueryDto) {
    const { page = 1, limit = 20, vendorId, status, from, to } = query;
    const where: Prisma.InvoiceWhereInput = {
      ...(vendorId ? { vendorId } : {}),
      ...(status ? { status } : {}),
      ...(from || to ? { issuedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { vendor: { select: { id: true, name: true } } },
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { vendor: { select: { id: true, name: true } }, payments: { orderBy: { paidOn: 'asc' } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async create(dto: CreateInvoiceDto, actor: AuthUser) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: dto.vendorId }, select: { id: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (dto.subscriptionId) {
      const sub = await this.prisma.vendorSubscription.findUnique({ where: { id: dto.subscriptionId } });
      if (!sub || sub.vendorId !== dto.vendorId) {
        throw new BadRequestException('Subscription does not belong to this vendor');
      }
    }
    if (dto.periodStart && dto.periodEnd && new Date(dto.periodEnd) <= new Date(dto.periodStart)) {
      throw new BadRequestException('periodEnd must be after periodStart');
    }

    const invoice = await this.insert(
      {
        vendorId: dto.vendorId,
        subscriptionId: dto.subscriptionId,
        status: dto.status ?? 'OPEN',
        description: dto.description,
        amount: D(dto.amount),
        periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
        dueAt: new Date(dto.dueAt),
        createdById: actor.userId,
      },
      true,
    );
    await this.audit.log({
      vendorId: dto.vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: 'INVOICE_CREATE',
      entity: 'Invoice',
      entityId: invoice.id,
      changes: { after: { number: invoice.number, amount: dto.amount, status: invoice.status } },
    });
    return invoice;
  }

  private async insert(data: Omit<Prisma.InvoiceUncheckedCreateInput, 'number'>, throwOnDuplicate: boolean) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const number = await this.nextNumber(tx);
        return tx.invoice.create({ data: { ...data, number } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        if (throwOnDuplicate) {
          throw new ConflictException('An invoice already exists for this subscription period');
        }
        return null;
      }
      throw e;
    }
  }

  /** Auto-renewal invoice (D7): idempotent through @@unique([subscriptionId, periodStart]); null when it already exists. */
  async createRenewalInvoice(
    sub: { id: string; vendorId: string; currentPeriodEnd: Date; plan: { price: Prisma.Decimal; currency: string; interval: any; name: string } },
  ) {
    const periodStart = sub.currentPeriodEnd;
    const periodEnd = addInterval(periodStart, sub.plan.interval);
    const invoice = await this.insert(
      {
        vendorId: sub.vendorId,
        subscriptionId: sub.id,
        status: 'OPEN',
        description: `${sub.plan.name} renewal`,
        amount: sub.plan.price,
        currency: sub.plan.currency,
        periodStart,
        periodEnd,
        dueAt: periodStart,
      },
      false,
    );
    if (invoice) {
      await this.audit.log({
        vendorId: sub.vendorId,
        userName: 'system',
        action: 'INVOICE_AUTO_RENEWAL',
        entity: 'Invoice',
        entityId: invoice.id,
        changes: { after: { number: invoice.number, amount: String(invoice.amount) } },
      });
    }
    return invoice;
  }

  async update(id: string, dto: UpdateInvoiceDto, actor: AuthUser) {
    const invoice = await this.findOne(id);
    if (invoice.status !== 'DRAFT') throw new ConflictException('Only DRAFT invoices can be edited');
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        ...(dto.amount !== undefined ? { amount: D(dto.amount) } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.dueAt ? { dueAt: new Date(dto.dueAt) } : {}),
        ...(dto.periodStart ? { periodStart: new Date(dto.periodStart) } : {}),
        ...(dto.periodEnd ? { periodEnd: new Date(dto.periodEnd) } : {}),
      },
    });
    await this.audit.log({
      vendorId: invoice.vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: 'INVOICE_UPDATE',
      entity: 'Invoice',
      entityId: id,
      changes: { after: dto },
    });
    return updated;
  }

  async issue(id: string, actor: AuthUser, now = new Date()) {
    const invoice = await this.findOne(id);
    if (invoice.status !== 'DRAFT') throw new ConflictException('Only DRAFT invoices can be issued');
    const updated = await this.prisma.invoice.update({ where: { id }, data: { status: 'OPEN', issuedAt: now } });
    await this.audit.log({
      vendorId: invoice.vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: 'INVOICE_ISSUE',
      entity: 'Invoice',
      entityId: id,
      changes: { before: { status: 'DRAFT' }, after: { status: 'OPEN' } },
    });
    return updated;
  }

  async void(id: string, dto: VoidInvoiceDto, actor: AuthUser, now = new Date()) {
    const invoice = await this.findOne(id);
    if (invoice.status === 'VOID') throw new ConflictException('Invoice is already void');
    if (invoice.payments.length > 0 || invoice.status === 'PAID') {
      throw new ConflictException('An invoice with payments cannot be voided');
    }
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: 'VOID', voidedAt: now, voidReason: dto.reason },
    });
    await this.audit.log({
      vendorId: invoice.vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: 'INVOICE_VOID',
      entity: 'Invoice',
      entityId: id,
      changes: { before: { status: invoice.status }, after: { status: 'VOID' }, reason: dto.reason },
    });
    return updated;
  }

  /**
   * Record an offline payment. Partial payments keep the invoice OPEN; the payment that brings the
   * total to the invoice amount marks it PAID and (for a subscription invoice) advances the period,
   * sets the subscription ACTIVE and clears pastDueSince — all in one transaction. A billing
   * auto-suspension is lifted after commit.
   */
  async recordPayment(id: string, dto: RecordPaymentDto, actor: AuthUser, now = new Date()) {
    const amount = D(dto.amount);

    const result = await this.prisma.$transaction(async (tx) => {
      // Row lock serialises concurrent payments on the same invoice so the over-payment check is exact.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
      const invoice = await tx.invoice.findUnique({ where: { id } });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status === 'DRAFT') throw new ConflictException('Issue the invoice before recording payments');
      if (invoice.status === 'VOID') throw new ConflictException('Cannot record a payment on a void invoice');
      if (invoice.status === 'PAID') throw new ConflictException('Invoice is already fully paid');

      const agg = await tx.invoicePayment.aggregate({ where: { invoiceId: id }, _sum: { amount: true } });
      const total = (agg._sum.amount ?? D(0)).add(amount);
      if (total.gt(invoice.amount)) {
        throw new BadRequestException(
          `Payment exceeds the outstanding balance (${invoice.amount.sub(agg._sum.amount ?? D(0)).toFixed(2)})`,
        );
      }

      const payment = await tx.invoicePayment.create({
        data: {
          invoiceId: id,
          vendorId: invoice.vendorId,
          amount,
          method: dto.method,
          reference: dto.reference,
          paidOn: new Date(dto.paidOn),
          notes: dto.notes,
          recordedById: actor.userId,
        },
      });

      const fullyPaid = total.eq(invoice.amount);
      const updatedInvoice = fullyPaid
        ? await tx.invoice.update({ where: { id }, data: { status: 'PAID', paidAt: now } })
        : invoice;

      let subscription = null;
      let liftSuspension = false;
      if (fullyPaid && invoice.subscriptionId) {
        const sub = await tx.vendorSubscription.findUnique({
          where: { id: invoice.subscriptionId },
          include: { plan: true },
        });
        if (sub && sub.status !== 'CANCELLED') {
          const start = sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
          subscription = await tx.vendorSubscription.update({
            where: { id: sub.id },
            data: {
              status: 'ACTIVE',
              currentPeriodStart: start,
              currentPeriodEnd: addInterval(start, sub.plan.interval),
              pastDueSince: null,
            },
          });
          liftSuspension = sub.suspendedByBilling;
        }
      }
      return { invoice: updatedInvoice, payment, subscription, liftSuspension, fullyPaid };
    });

    await this.planLimits.invalidate(result.invoice.vendorId);

    if (result.liftSuspension) {
      try {
        await this.vendors.unsuspend(result.invoice.vendorId);
      } catch (e) {
        // Already active (ConflictException) is fine; anything else is logged and the flag is still cleared
        // only when the vendor really is active.
        this.logger.warn(`Billing unsuspend for vendor ${result.invoice.vendorId}: ${(e as Error).message}`);
      }
      const vendor = await this.prisma.vendor.findUnique({ where: { id: result.invoice.vendorId }, select: { isActive: true } });
      if (vendor?.isActive && result.subscription) {
        await this.prisma.vendorSubscription.update({
          where: { id: result.subscription.id },
          data: { suspendedByBilling: false },
        });
        await this.audit.log({
          vendorId: result.invoice.vendorId,
          userId: actor.userId,
          userName: actor.name,
          action: 'BILLING_AUTO_UNSUSPEND',
          entity: 'Vendor',
          entityId: result.invoice.vendorId,
        });
      }
    }

    await this.audit.log({
      vendorId: result.invoice.vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: 'INVOICE_PAYMENT',
      entity: 'Invoice',
      entityId: id,
      changes: {
        after: {
          paymentId: result.payment.id,
          amount: dto.amount,
          method: dto.method,
          invoiceStatus: result.invoice.status,
          subscriptionStatus: result.subscription?.status,
        },
      },
    });

    const { liftSuspension: _l, fullyPaid: _f, ...out } = result;
    return out;
  }
}
