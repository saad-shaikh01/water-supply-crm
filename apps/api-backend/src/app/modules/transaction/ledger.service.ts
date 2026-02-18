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
    filledDropped: number;
    emptyReceived: number;
    cashCollected: number;
    pricePerBottle: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const totalAmount = data.filledDropped * data.pricePerBottle;

      await tx.bottleWallet.update({
        where: {
          customerId_productId: {
            customerId: data.customerId,
            productId: data.productId,
          },
        },
        data: {
          balance: { increment: data.filledDropped - data.emptyReceived },
        },
      });

      const balanceChange = totalAmount - data.cashCollected;
      await tx.customer.update({
        where: { id: data.customerId },
        data: {
          financialBalance: { increment: balanceChange },
        },
      });

      await tx.transaction.create({
        data: {
          type: TransactionType.DELIVERY,
          vendorId: data.vendorId,
          customerId: data.customerId,
          productId: data.productId,
          dailySheetId: data.dailySheetId,
          filledDropped: data.filledDropped,
          emptyReceived: data.emptyReceived,
          bottleCount: data.filledDropped - data.emptyReceived,
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
            amount: -data.cashCollected,
            description: `Cash collected during delivery`,
          },
        });
      }

      await this.cache.invalidateCustomerWallets(
        data.vendorId,
        data.customerId,
      );

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
      if (dateTo) where.createdAt.lte = new Date(dateTo);
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
