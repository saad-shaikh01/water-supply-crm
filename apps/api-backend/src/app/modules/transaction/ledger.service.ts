import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { TransactionType } from '@prisma/client';

@Injectable()
export class LedgerService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheInvalidationService,
  ) {}

  /**
   * Records a delivery transaction.
   * - Updates BottleWallet (Adds filled, subtracts empty)
   * - Updates FinancialBalance (Adds price of dropped bottles)
   * - Creates Transaction record
   */
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

      // 1. Update Bottle Wallet
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

      // 2. Update Financial Balance
      // We increment the balance by (total price - cash collected)
      const balanceChange = totalAmount - data.cashCollected;
      await tx.customer.update({
        where: { id: data.customerId },
        data: {
          financialBalance: { increment: balanceChange },
        },
      });

      // 3. Create Transaction Records
      // Record the delivery itself
      await tx.transaction.create({
        data: {
          type: TransactionType.DELIVERY,
          vendorId: data.vendorId,
          customerId: data.customerId,
          productId: data.productId,
          dailySheetId: data.dailySheetId,
          bottleCount: data.filledDropped - data.emptyReceived,
          amount: totalAmount,
          description: `Delivered ${data.filledDropped}, Received ${data.emptyReceived}`,
        },
      });

      // If cash was collected, record it as a PAYMENT transaction
      if (data.cashCollected > 0) {
        await tx.transaction.create({
          data: {
            type: TransactionType.PAYMENT,
            vendorId: data.vendorId,
            customerId: data.customerId,
            dailySheetId: data.dailySheetId,
            amount: -data.cashCollected, // Payment reduces balance
            description: `Cash collected during delivery`,
          },
        });
      }

      // Invalidate wallet cache after delivery
      await this.cache.invalidateCustomerWallets(data.vendorId, data.customerId);

      return { success: true };
    });
  }
}
