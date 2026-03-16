import { NotFoundException } from '@nestjs/common';
import { CACHE_KEYS, CacheInvalidationService } from '@water-supply-crm/caching';
import { TransactionType } from '@prisma/client';
import { LedgerService } from './ledger.service';
import {
  createMockCustomer,
  createMockTransaction,
  createPrismaMock,
  createPrismaProvider,
  createTestModule,
  mockPrismaTransaction,
  mockVendorId,
  PrismaMock,
} from '../../../test';

describe('LedgerService', () => {
  let service: LedgerService;
  let prisma: PrismaMock;
  let cache: {
    invalidateVendorEntity: jest.Mock;
    invalidateCustomerWallets: jest.Mock;
  };

  beforeEach(async () => {
    prisma = createPrismaMock();
    mockPrismaTransaction(prisma);
    cache = {
      invalidateVendorEntity: jest.fn().mockResolvedValue(undefined),
      invalidateCustomerWallets: jest.fn().mockResolvedValue(undefined),
    };

    const module = await createTestModule({
      providers: [
        LedgerService,
        createPrismaProvider(prisma),
        { provide: CacheInvalidationService, useValue: cache },
      ],
    });

    service = module.get(LedgerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('recordPayment', () => {
    it('records a negative PAYMENT transaction, decrements balance, and invalidates customer cache', async () => {
      prisma.customer.findFirst.mockResolvedValue(
        createMockCustomer({
          id: 'customer-1',
          vendorId: mockVendorId,
          financialBalance: 900,
        }) as never,
      );
      prisma.customer.update.mockResolvedValue(
        createMockCustomer({
          id: 'customer-1',
          vendorId: mockVendorId,
          financialBalance: 600,
        }) as never,
      );
      prisma.transaction.create.mockResolvedValue(
        createMockTransaction({
          type: TransactionType.PAYMENT,
          vendorId: mockVendorId,
          customerId: 'customer-1',
          amount: -300,
          description: 'Cash payment',
        }) as never,
      );

      await service.recordPayment(mockVendorId, {
        customerId: 'customer-1',
        amount: 300,
        description: 'Cash payment',
      });

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-1' },
        data: { financialBalance: { decrement: 300 } },
      });
      expect(prisma.transaction.create).toHaveBeenCalledWith({
        data: {
          type: TransactionType.PAYMENT,
          vendorId: mockVendorId,
          customerId: 'customer-1',
          amount: -300,
          description: 'Cash payment',
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phoneNumber: true,
              financialBalance: true,
            },
          },
        },
      });
      expect(cache.invalidateVendorEntity).toHaveBeenCalledWith(
        mockVendorId,
        CACHE_KEYS.CUSTOMERS,
      );
    });

    it('throws NotFoundException when the customer is outside the vendor scope', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.recordPayment(mockVendorId, {
          customerId: 'missing-customer',
          amount: 300,
        }),
      ).rejects.toThrow(new NotFoundException('Customer not found'));
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });
  });

  describe('recordAdjustment', () => {
    it('applies financial and bottle deltas, writes an ADJUSTMENT transaction, and invalidates both caches', async () => {
      prisma.customer.findFirst.mockResolvedValue(
        createMockCustomer({
          id: 'customer-1',
          vendorId: mockVendorId,
          financialBalance: 200,
        }) as never,
      );
      prisma.customer.update.mockResolvedValue(
        createMockCustomer({
          id: 'customer-1',
          vendorId: mockVendorId,
          financialBalance: 150,
        }) as never,
      );
      prisma.bottleWallet.update.mockResolvedValue({
        customerId: 'customer-1',
        productId: 'product-1',
        balance: 3,
      } as never);
      prisma.transaction.create.mockResolvedValue(
        createMockTransaction({
          type: TransactionType.ADJUSTMENT,
          vendorId: mockVendorId,
          customerId: 'customer-1',
          productId: 'product-1',
          bottleCount: -2,
          amount: -50,
          description: 'Goodwill credit',
        }) as never,
      );

      await service.recordAdjustment(mockVendorId, {
        customerId: 'customer-1',
        productId: 'product-1',
        bottleCount: -2,
        amount: -50,
        description: 'Goodwill credit',
      });

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-1' },
        data: { financialBalance: { increment: -50 } },
      });
      expect(prisma.bottleWallet.update).toHaveBeenCalledWith({
        where: {
          customerId_productId: {
            customerId: 'customer-1',
            productId: 'product-1',
          },
        },
        data: { balance: { increment: -2 } },
      });
      expect(prisma.transaction.create).toHaveBeenCalledWith({
        data: {
          type: TransactionType.ADJUSTMENT,
          vendorId: mockVendorId,
          customerId: 'customer-1',
          productId: 'product-1',
          bottleCount: -2,
          amount: -50,
          description: 'Goodwill credit',
        },
      });
      expect(cache.invalidateVendorEntity).toHaveBeenCalledWith(
        mockVendorId,
        CACHE_KEYS.CUSTOMERS,
      );
      expect(cache.invalidateCustomerWallets).toHaveBeenCalledWith(
        mockVendorId,
        'customer-1',
      );
    });

    it('skips balance and wallet updates when the adjustment only stores a note', async () => {
      prisma.customer.findFirst.mockResolvedValue(
        createMockCustomer({
          id: 'customer-1',
          vendorId: mockVendorId,
        }) as never,
      );
      prisma.transaction.create.mockResolvedValue(
        createMockTransaction({
          type: TransactionType.ADJUSTMENT,
          vendorId: mockVendorId,
          customerId: 'customer-1',
          amount: 0,
          bottleCount: 0,
          description: 'Manual note',
        }) as never,
      );

      await service.recordAdjustment(mockVendorId, {
        customerId: 'customer-1',
        description: 'Manual note',
      });

      expect(prisma.customer.update).not.toHaveBeenCalled();
      expect(prisma.bottleWallet.update).not.toHaveBeenCalled();
      expect(cache.invalidateCustomerWallets).not.toHaveBeenCalled();
      expect(prisma.transaction.create).toHaveBeenCalledWith({
        data: {
          type: TransactionType.ADJUSTMENT,
          vendorId: mockVendorId,
          customerId: 'customer-1',
          productId: undefined,
          bottleCount: 0,
          amount: 0,
          description: 'Manual note',
        },
      });
    });
  });

  describe('getTransactionSummary', () => {
    it('normalizes payment totals and returns the net figure from the three aggregate buckets', async () => {
      prisma.transaction.aggregate
        .mockResolvedValueOnce({
          _sum: { amount: 1200 },
          _count: { _all: 2 },
        } as never)
        .mockResolvedValueOnce({
          _sum: { amount: -350 },
          _count: { _all: 1 },
        } as never)
        .mockResolvedValueOnce({
          _sum: { amount: -50 },
          _count: { _all: 1 },
        } as never);

      const result = await service.getTransactionSummary(mockVendorId, {
        customerId: 'customer-1',
        vanId: 'van-1',
        search: 'ali',
        dateFrom: '2025-01-01',
        dateTo: '2025-01-31',
      });

      expect(prisma.transaction.aggregate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            vendorId: mockVendorId,
            customerId: 'customer-1',
            type: TransactionType.DELIVERY,
            dailySheet: { vanId: 'van-1' },
          }),
        }),
      );
      expect(result).toEqual({
        totalCharges: 1200,
        totalCollections: 350,
        totalAdjustments: -50,
        chargeCount: 2,
        paymentCount: 1,
        adjustmentCount: 1,
        totalCount: 4,
        net: 800,
      });
    });
  });

  describe('getCustomerLedgerSummary', () => {
    it('returns the live financial balance, wallets, and recent transactions for the scoped customer', async () => {
      const wallets = [
        {
          id: 'wallet-1',
          customerId: 'customer-1',
          productId: 'product-1',
          balance: 4,
          product: { id: 'product-1', name: '19L Water Bottle' },
        },
      ];
      const recentTransactions = [
        createMockTransaction({
          id: 'txn-1',
          vendorId: mockVendorId,
          customerId: 'customer-1',
          amount: -300,
          type: TransactionType.PAYMENT,
        }),
      ];
      prisma.customer.findFirst.mockResolvedValue(
        {
          ...createMockCustomer({
            id: 'customer-1',
            vendorId: mockVendorId,
            financialBalance: 450,
          }),
          wallets,
        } as never,
      );
      prisma.transaction.findMany.mockResolvedValue(recentTransactions as never);

      const result = await service.getCustomerLedgerSummary(
        mockVendorId,
        'customer-1',
      );

      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'customer-1', vendorId: mockVendorId },
        include: {
          wallets: {
            include: {
              product: { select: { id: true, name: true } },
            },
          },
        },
      });
      expect(result).toEqual({
        financialBalance: 450,
        wallets,
        recentTransactions,
      });
    });

    it('throws NotFoundException when the customer is not visible to the vendor', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.getCustomerLedgerSummary(mockVendorId, 'missing-customer'),
      ).rejects.toThrow(new NotFoundException('Customer not found'));
    });
  });
});
