import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  CacheInvalidationService,
  CACHE_KEYS,
} from '@water-supply-crm/caching';
import { TransactionType } from '@prisma/client';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { RecordAdjustmentDto } from './dto/record-adjustment.dto';
import { TransactionQueryDto } from './dto/transaction-query.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { paginate } from '../../common/helpers/paginate';

@Injectable()
export class LedgerService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  async recordDelivery(data: {
    vendorId: string;
    customerId: string;
    productId: string;
    dailySheetId: string;
    /** Links transactions to the source item — enables idempotent re-posting on edit. */
    dailySheetItemId?: string;
    filledDropped: number;
    emptyReceived: number;
    cashCollected: number;
    pricePerBottle: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const totalAmount = data.filledDropped * data.pricePerBottle;
      const newBottleChange = data.filledDropped - data.emptyReceived;
      const newFinancialEffect = totalAmount - data.cashCollected;

      // ── Idempotent re-post: if this item already has ledger entries, apply delta only ──
      if (data.dailySheetItemId) {
        const existingDelivery = await tx.transaction.findFirst({
          where: { dailySheetItemId: data.dailySheetItemId, type: TransactionType.DELIVERY },
        });

        if (existingDelivery) {
          const existingPayment = await tx.transaction.findFirst({
            where: { dailySheetItemId: data.dailySheetItemId, type: TransactionType.PAYMENT },
          });

          // Reconstruct what was previously applied to balances from the stored row values
          const oldBottleChange = existingDelivery.bottleCount ?? 0;
          // existingDelivery.amount = positive charge; existingPayment.amount = negative cash
          const oldFinancialEffect =
            (existingDelivery.amount ?? 0) + (existingPayment?.amount ?? 0);

          const deltaBottle = newBottleChange - oldBottleChange;
          const deltaFinancial = newFinancialEffect - oldFinancialEffect;

          if (deltaBottle !== 0) {
            await tx.bottleWallet.update({
              where: {
                customerId_productId: {
                  customerId: data.customerId,
                  productId: data.productId,
                },
              },
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
          await tx.transaction.deleteMany({
            where: { dailySheetItemId: data.dailySheetItemId },
          });

          await tx.transaction.create({
            data: {
              type: TransactionType.DELIVERY,
              vendorId: data.vendorId,
              customerId: data.customerId,
              productId: data.productId,
              dailySheetId: data.dailySheetId,
              dailySheetItemId: data.dailySheetItemId,
              filledDropped: data.filledDropped,
              emptyReceived: data.emptyReceived,
              bottleCount: newBottleChange,
              amount: totalAmount,
              description: `Delivered ${data.filledDropped}, Received ${data.emptyReceived}`,
            },
          });

          if (data.cashCollected > 0) {
            await tx.transaction.create({
              data: {
                type: TransactionType.PAYMENT,
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
          return { success: true };
        }
      }

      // ── First-time posting ──
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
          vendorId: data.vendorId,
          customerId: data.customerId,
          productId: data.productId,
          dailySheetId: data.dailySheetId,
          ...(data.dailySheetItemId && { dailySheetItemId: data.dailySheetItemId }),
          filledDropped: data.filledDropped,
          emptyReceived: data.emptyReceived,
          bottleCount: newBottleChange,
          amount: totalAmount,
          description: `Delivered ${data.filledDropped}, Received ${data.emptyReceived}`,
        },
      });

      if (data.cashCollected > 0) {
        await tx.transaction.create({
          data: {
            type: TransactionType.PAYMENT,
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
    });
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
        },
        include: {
          customer: { select: { id: true, name: true, phoneNumber: true, financialBalance: true } },
        },
      });

      await this.cache.invalidateVendorEntity(vendorId, CACHE_KEYS.CUSTOMERS);

      return transaction;
    });
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
    const { page = 1, limit = 20, customerId, vanId, type, dateFrom, dateTo } = query;

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

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, customerCode: true } },
          product: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return paginate(data, total, page, limit);
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
