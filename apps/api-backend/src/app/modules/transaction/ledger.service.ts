import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  CacheInvalidationService,
  CACHE_KEYS,
} from '@water-supply-crm/caching';
import {
  Prisma,
  TransactionType,
  PaymentEditReason,
  NotificationType,
} from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { RecordAdjustmentDto } from './dto/record-adjustment.dto';
import { TransactionQueryDto } from './dto/transaction-query.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/helpers/paginate';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import { MessageTemplates } from '../whatsapp/templates/message.templates';

/** Plain input shapes — Phase 3 builds the class-validator DTOs that produce these. */
export interface EditPaymentInput {
  amount: number;              // new gross payment amount, > 0
  description?: string;        // optional; when omitted keep existing description
  reason: PaymentEditReason;
  reasonNote?: string;         // required by caller only when reason === OTHER (Phase 3 validates)
  expectedUpdatedAt: string;   // ISO timestamp the client read; optimistic-lock token
}

export interface DeletePaymentInput {
  reason: PaymentEditReason;
  reasonNote?: string;
  expectedUpdatedAt: string;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
    private notifications: NotificationService,
    private audit: AuditService,
  ) {}

  async recordDelivery(
    data: {
      vendorId: string;
      customerId: string;
      productId: string;
      dailySheetId: string;
      /** Links transactions to the source item — enables idempotent re-posting on edit. */
      dailySheetItemId?: string;
      filledDropped: number;
      emptyReceived: number;
      /** Already-filled bottles received back from the customer (account closing,
       * excess stock return). Optional for backward compatibility with callers
       * (e.g. bulk-import) that don't have this concept — defaults to 0. Treated
       * financially the same as emptyReceived: reduces the bottle wallet, no charge. */
      filledReceived?: number;
      cashCollected: number;
      pricePerBottle: number;
      /** Business date for the posted transactions. Defaults to now (createdAt).
       * Correction entries pass the closed sheet's date so the delivery lands on
       * the day it actually happened — on the monthly statement, in analytics,
       * and in the portal transaction list — rather than the day it was keyed in. */
      occurredAt?: Date;
    },
    txClient?: Prisma.TransactionClient,
  ) {
    const run = async (tx: Prisma.TransactionClient) => {
      const filledReceived = data.filledReceived ?? 0;
      const totalAmount = data.filledDropped * data.pricePerBottle;
      const newBottleChange = data.filledDropped - data.emptyReceived - filledReceived;
      const newFinancialEffect = totalAmount - data.cashCollected;

      // ── Idempotent re-post: if this item already has ledger entries, apply delta only ──
      if (data.dailySheetItemId) {
        const reposted = await this.applyIdempotentRepost(
          tx,
          { ...data, dailySheetItemId: data.dailySheetItemId },
          { totalAmount, newBottleChange, newFinancialEffect },
        );
        if (reposted) return { success: true };
      }

      // ── First-time posting ──
      const walletForCheck = await tx.bottleWallet.findUnique({
        where: {
          customerId_productId: {
            customerId: data.customerId,
            productId: data.productId,
          },
        },
      });
      if (!walletForCheck || walletForCheck.balance + newBottleChange < 0) {
        const available = (walletForCheck?.balance ?? 0) + data.filledDropped;
        throw new BadRequestException(
          `Cannot collect ${data.emptyReceived} empty + ${filledReceived} filled bottle(s) — only ${available} available ` +
          `(wallet: ${walletForCheck?.balance ?? 0} + dropped: ${data.filledDropped}).`,
        );
      }

      await tx.bottleWallet.update({
        where: {
          customerId_productId: {
            customerId: data.customerId,
            productId: data.productId,
          },
        },
        data: { balance: { increment: newBottleChange } },
      });

      await tx.customer.update({
        where: { id: data.customerId },
        data: { financialBalance: { increment: newFinancialEffect } },
      });

      await tx.transaction.create({
        data: {
          type: TransactionType.DELIVERY,
          ...(data.occurredAt && { createdAt: data.occurredAt }),
          vendorId: data.vendorId,
          customerId: data.customerId,
          productId: data.productId,
          dailySheetId: data.dailySheetId,
          ...(data.dailySheetItemId && { dailySheetItemId: data.dailySheetItemId }),
          filledDropped: data.filledDropped,
          emptyReceived: data.emptyReceived,
          filledReceived,
          bottleCount: newBottleChange,
          amount: totalAmount,
          description: filledReceived > 0
            ? `Delivered ${data.filledDropped}, Empty Received ${data.emptyReceived}, Filled Received ${filledReceived}`
            : `Delivered ${data.filledDropped}, Received ${data.emptyReceived}`,
        },
      });

      if (data.cashCollected > 0) {
        await tx.transaction.create({
          data: {
            type: TransactionType.PAYMENT,
            ...(data.occurredAt && { createdAt: data.occurredAt }),
            vendorId: data.vendorId,
            customerId: data.customerId,
            dailySheetId: data.dailySheetId,
            ...(data.dailySheetItemId && { dailySheetItemId: data.dailySheetItemId }),
            amount: -data.cashCollected,
            description: `Cash collected during delivery`,
          },
        });
      }

      await this.cache.invalidateCustomerWallets(data.vendorId, data.customerId);
      return { success: true };
    };

    return txClient ? run(txClient) : this.prisma.$transaction(run);
  }

  private async applyIdempotentRepost(
    tx: Prisma.TransactionClient,
    data: {
      vendorId: string;
      customerId: string;
      productId: string;
      dailySheetId: string;
      dailySheetItemId: string;
      filledDropped: number;
      emptyReceived: number;
      filledReceived?: number;
      cashCollected: number;
      /** Preserved from recordDelivery — keeps a corrected entry's business date
       * (the closed sheet's date) when its transactions are re-posted on edit. */
      occurredAt?: Date;
    },
    computed: { totalAmount: number; newBottleChange: number; newFinancialEffect: number },
  ): Promise<boolean> {
    const existingDelivery = await tx.transaction.findFirst({
      where: { dailySheetItemId: data.dailySheetItemId, type: TransactionType.DELIVERY },
    });
    if (!existingDelivery) return false;

    const existingPayment = await tx.transaction.findFirst({
      where: { dailySheetItemId: data.dailySheetItemId, type: TransactionType.PAYMENT },
    });

    // Reconstruct what was previously applied to balances from the stored row values
    const oldBottleChange = existingDelivery.bottleCount ?? 0;
    // existingDelivery.amount = positive charge; existingPayment.amount = negative cash
    const oldFinancialEffect =
      (existingDelivery.amount ?? 0) + (existingPayment?.amount ?? 0);

    const deltaBottle = computed.newBottleChange - oldBottleChange;
    const deltaFinancial = computed.newFinancialEffect - oldFinancialEffect;

    if (deltaBottle < 0) {
      const currentWallet = await tx.bottleWallet.findUnique({
        where: { customerId_productId: { customerId: data.customerId, productId: data.productId } },
      });
      if (currentWallet && currentWallet.balance + deltaBottle < 0) {
        throw new BadRequestException(
          `Editing this delivery would make the bottle wallet negative ` +
          `(current: ${currentWallet.balance}, delta: ${deltaBottle}).`,
        );
      }
    }

    if (deltaBottle !== 0) {
      await tx.bottleWallet.update({
        where: { customerId_productId: { customerId: data.customerId, productId: data.productId } },
        data: { balance: { increment: deltaBottle } },
      });
    }

    if (deltaFinancial !== 0) {
      await tx.customer.update({
        where: { id: data.customerId },
        data: { financialBalance: { increment: deltaFinancial } },
      });
    }

    // Replace old transactions with updated values
    await tx.transaction.deleteMany({ where: { dailySheetItemId: data.dailySheetItemId } });

    await tx.transaction.create({
      data: {
        type: TransactionType.DELIVERY,
        ...(data.occurredAt && { createdAt: data.occurredAt }),
        vendorId: data.vendorId,
        customerId: data.customerId,
        productId: data.productId,
        dailySheetId: data.dailySheetId,
        dailySheetItemId: data.dailySheetItemId,
        filledDropped: data.filledDropped,
        emptyReceived: data.emptyReceived,
        filledReceived: data.filledReceived ?? 0,
        bottleCount: computed.newBottleChange,
        amount: computed.totalAmount,
        description: (data.filledReceived ?? 0) > 0
          ? `Delivered ${data.filledDropped}, Empty Received ${data.emptyReceived}, Filled Received ${data.filledReceived}`
          : `Delivered ${data.filledDropped}, Received ${data.emptyReceived}`,
      },
    });

    if (data.cashCollected > 0) {
      await tx.transaction.create({
        data: {
          type: TransactionType.PAYMENT,
          ...(data.occurredAt && { createdAt: data.occurredAt }),
          vendorId: data.vendorId,
          customerId: data.customerId,
          dailySheetId: data.dailySheetId,
          dailySheetItemId: data.dailySheetItemId,
          amount: -data.cashCollected,
          description: `Cash collected during delivery`,
        },
      });
    }

    await this.cache.invalidateCustomerWallets(data.vendorId, data.customerId);
    return true;
  }

  async recordPayment(vendorId: string, dto: RecordPaymentDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, vendorId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: dto.customerId },
        data: {
          financialBalance: { decrement: dto.amount },
        },
      });

      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.PAYMENT,
          vendorId,
          customerId: dto.customerId,
          amount: -dto.amount,
          description: dto.description || 'Payment received',
          ...(dto.paymentRequestId ? { paymentRequestId: dto.paymentRequestId } : {}),
        },
        include: {
          customer: { select: { id: true, name: true, phoneNumber: true, financialBalance: true } },
        },
      });

      await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);

      return transaction;
    });
  }

  /**
   * Manual edit of a standalone PAYMENT transaction (dashboard correction).
   * Only payments that were entered manually — not collected during a delivery,
   * and not sourced from an online/portal payment request — are editable here.
   * Applies the balance delta, keeps an optimistic lock on `updatedAt`, writes
   * an audit entry and (when the amount changed) a WhatsApp correction notice.
   */
  async editPayment(
    vendorId: string,
    txId: string,
    input: EditPaymentInput,
    user: AuthUser,
  ) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: txId, vendorId },
      include: {
        customer: { select: { id: true, name: true, phoneNumber: true } },
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    if (tx.type !== TransactionType.PAYMENT) {
      throw new ConflictException('Only payment transactions can be edited.');
    }
    if (tx.dailySheetId || tx.dailySheetItemId) {
      throw new ConflictException(
        'This payment was collected during a delivery. Edit it from the delivery record instead.',
      );
    }
    if (tx.paymentRequestId) {
      throw new ConflictException(
        'This payment came from an online/portal payment request and cannot be edited here.',
      );
    }

    // PAYMENT amounts are stored negative. Positive delta ⇒ customer paid less
    // than before ⇒ financialBalance must go UP.
    const oldAmount = -Number(tx.amount);
    const newAmount = input.amount;
    const delta = oldAmount - newAmount;

    const updated = await this.prisma.$transaction(async (txc) => {
      const claimed = await txc.transaction.updateMany({
        where: {
          id: txId,
          vendorId,
          updatedAt: new Date(input.expectedUpdatedAt),
        },
        data: {
          amount: -newAmount,
          description: input.description ?? tx.description,
          lastEditedAt: new Date(),
          lastEditedById: user.userId,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'This payment was changed by someone else. Reload and try again.',
        );
      }

      if (delta !== 0) {
        await txc.customer.update({
          where: { id: tx.customerId! },
          data: { financialBalance: { increment: delta } },
        });
      }

      const row = await txc.transaction.findUnique({
        where: { id: txId },
        include: {
          customer: {
            select: { id: true, name: true, phoneNumber: true, financialBalance: true },
          },
        },
      });

      await Promise.all([
        this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS),
        this.cache.invalidateOverview(vendorId),
        this.cache.invalidateCustomerWallets(vendorId, tx.customerId!),
        this.cache.invalidateAnalytics(vendorId),
      ]);

      return row!;
    });

    // Fire-and-forget side effects — never throw.
    await this.audit.log({
      vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATE',
      entity: 'Transaction',
      entityId: txId,
      changes: {
        before: { amount: oldAmount, description: tx.description },
        after: {
          amount: newAmount,
          description: input.description ?? tx.description,
          editReason: input.reason,
          editReasonNote: input.reasonNote ?? null,
        },
      },
    });

    if (delta !== 0 && updated.customer?.phoneNumber) {
      this.notifications
        .queueWhatsApp(
          updated.customer.phoneNumber,
          MessageTemplates.paymentCorrected(
            updated.customer.name,
            oldAmount,
            newAmount,
            Math.max(0, updated.customer.financialBalance),
          ),
          `ntf:payment-correction:${txId}:${updated.lastEditedAt!.getTime()}:wa`,
          {
            vendorId,
            type: NotificationType.PAYMENT_RECEIVED,
            recipientType: 'CUSTOMER',
            recipientId: tx.customerId!,
          },
        )
        .catch((e) =>
          this.logger?.warn?.(`payment-correction WhatsApp failed: ${e.message}`),
        );
    }

    return {
      transaction: updated,
      previousAmount: oldAmount,
      newAmount,
      delta,
      newBalance: updated.customer.financialBalance,
    };
  }

  /**
   * Reverse (hard-delete) a standalone PAYMENT transaction and undo its balance
   * effect. Same editable-scope guards as `editPayment`.
   */
  async deletePayment(
    vendorId: string,
    txId: string,
    input: DeletePaymentInput,
    user: AuthUser,
  ) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: txId, vendorId },
      include: {
        customer: { select: { id: true, name: true, phoneNumber: true } },
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    if (tx.type !== TransactionType.PAYMENT) {
      throw new ConflictException('Only payment transactions can be edited.');
    }
    if (tx.dailySheetId || tx.dailySheetItemId) {
      throw new ConflictException(
        'This payment was collected during a delivery. Edit it from the delivery record instead.',
      );
    }
    if (tx.paymentRequestId) {
      throw new ConflictException(
        'This payment came from an online/portal payment request and cannot be edited here.',
      );
    }

    // Original write decremented the balance by this amount; deleting undoes it.
    const reversedAmount = -Number(tx.amount);

    const cust = await this.prisma.$transaction(async (txc) => {
      const claimed = await txc.transaction.deleteMany({
        where: {
          id: txId,
          vendorId,
          updatedAt: new Date(input.expectedUpdatedAt),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'This payment was changed or already removed by someone else. Reload and try again.',
        );
      }

      await txc.customer.update({
        where: { id: tx.customerId! },
        data: { financialBalance: { increment: reversedAmount } },
      });

      const row = await txc.customer.findUnique({
        where: { id: tx.customerId! },
        select: { financialBalance: true },
      });

      await Promise.all([
        this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS),
        this.cache.invalidateOverview(vendorId),
        this.cache.invalidateCustomerWallets(vendorId, tx.customerId!),
        this.cache.invalidateAnalytics(vendorId),
      ]);

      return row!;
    });

    await this.audit.log({
      vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'DELETE',
      entity: 'Transaction',
      entityId: txId,
      changes: {
        before: {
          amount: reversedAmount,
          description: tx.description,
          customerId: tx.customerId,
          createdAt: tx.createdAt,
        },
        after: {
          deleteReason: input.reason,
          deleteReasonNote: input.reasonNote ?? null,
        },
      },
    });

    if (tx.customer?.phoneNumber) {
      this.notifications
        .queueWhatsApp(
          tx.customer.phoneNumber,
          MessageTemplates.paymentReversed(
            tx.customer.name,
            reversedAmount,
            Math.max(0, cust.financialBalance),
          ),
          `ntf:payment-reversal:${txId}:wa`,
          {
            vendorId,
            type: NotificationType.PAYMENT_RECEIVED,
            recipientType: 'CUSTOMER',
            recipientId: tx.customerId!,
          },
        )
        .catch((e) =>
          this.logger?.warn?.(`payment-reversal WhatsApp failed: ${e.message}`),
        );
    }

    return {
      transactionId: txId,
      reversedAmount,
      newBalance: cust.financialBalance,
    };
  }

  async recordAdjustment(vendorId: string, dto: RecordAdjustmentDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, vendorId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.amount) {
        await tx.customer.update({
          where: { id: dto.customerId },
          data: {
            financialBalance: { increment: dto.amount },
          },
        });
      }

      if (dto.bottleCount && dto.productId) {
        await tx.bottleWallet.update({
          where: {
            customerId_productId: {
              customerId: dto.customerId,
              productId: dto.productId,
            },
          },
          data: {
            balance: { increment: dto.bottleCount },
          },
        });
      }

      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.ADJUSTMENT,
          vendorId,
          customerId: dto.customerId,
          productId: dto.productId,
          bottleCount: dto.bottleCount || 0,
          amount: dto.amount || 0,
          description: dto.description,
        },
      });

      await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);
      if (dto.productId) {
        await this.cache.invalidateCustomerWallets(vendorId, dto.customerId);
      }

      return transaction;
    });
  }

  async findAllPaginated(vendorId: string, query: TransactionQueryDto) {
    const { page = 1, limit = 20, customerId, vanId, type, dateFrom, dateTo, search } = query;

    const where: any = { vendorId };

    if (customerId) where.customerId = customerId;
    if (vanId) where.dailySheet = { vanId };
    if (type) where.type = type;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    if (search) {
      where.OR = [
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { customerCode: { contains: search, mode: 'insensitive' } } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, customerCode: true, phoneNumber: true } },
          product: { select: { id: true, name: true } },
          // Lets the transactions page offer "Resend Receipt" by reusing
          // DailySheetService.resendDeliveryReceipt — dailySheetItemId is
          // already a column on this model; only the linked item's status
          // is new here, so the button can be disabled up front for a
          // non-COMPLETED item instead of round-tripping to a 400.
          dailySheetItem: { select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  /**
   * Aggregate summary for the active filter window.
   * Always breaks down all three types regardless of the `type` query param.
   * The type filter applies to the paginated list, not the summary strip.
   */
  async getTransactionSummary(vendorId: string, query: TransactionQueryDto) {
    const { customerId, vanId, dateFrom, dateTo, search } = query;

    const baseWhere: any = { vendorId };
    if (customerId) baseWhere.customerId = customerId;
    if (vanId) baseWhere.dailySheet = { vanId };
    if (dateFrom || dateTo) {
      baseWhere.createdAt = {};
      if (dateFrom) baseWhere.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        baseWhere.createdAt.lte = end;
      }
    }
    if (search) {
      baseWhere.OR = [
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { customerCode: { contains: search, mode: 'insensitive' } } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [deliveryAgg, paymentAgg, adjustmentAgg] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { ...baseWhere, type: TransactionType.DELIVERY },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...baseWhere, type: TransactionType.PAYMENT },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...baseWhere, type: TransactionType.ADJUSTMENT },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const totalCharges = deliveryAgg._sum.amount ?? 0;
    // PAYMENT amounts are stored as negative (e.g. -500); negate for display
    const totalCollections = Math.abs(paymentAgg._sum.amount ?? 0);
    const totalAdjustments = adjustmentAgg._sum.amount ?? 0;
    const chargeCount = deliveryAgg._count._all;
    const paymentCount = paymentAgg._count._all;
    const adjustmentCount = adjustmentAgg._count._all;

    return {
      totalCharges,
      totalCollections,
      totalAdjustments,
      chargeCount,
      paymentCount,
      adjustmentCount,
      totalCount: chargeCount + paymentCount + adjustmentCount,
      net: totalCharges - totalCollections + totalAdjustments,
    };
  }

  async findByCustomer(
    vendorId: string,
    customerId: string,
    pagination: PaginationQueryDto,
  ) {
    const { page = 1, limit = 20 } = pagination;

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const where = { customerId, vendorId };

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          product: { select: { id: true, name: true } },
          // Same "Resend Receipt" reuse as findAllPaginated above — this
          // customer-scoped view backs the same TransactionList component
          // (rendered on the customer detail page's transaction tab), which
          // doesn't otherwise have the customer's phone/item status on hand.
          customer: { select: { phoneNumber: true } },
          dailySheetItem: { select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getCustomerLedgerSummary(vendorId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, vendorId },
      include: {
        wallets: { include: { product: { select: { id: true, name: true } } } },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const recentTransactions = await this.prisma.transaction.findMany({
      where: { customerId, vendorId },
      include: { product: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      financialBalance: customer.financialBalance,
      wallets: customer.wallets,
      recentTransactions,
    };
  }
}
