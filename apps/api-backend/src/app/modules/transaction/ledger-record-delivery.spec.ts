import { Test, TestingModule } from '@nestjs/testing';
import { LedgerService } from './ledger.service';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { TransactionType } from '@prisma/client';

// ── Minimal Prisma mock ────────────────────────────────────────────────────────
function buildMockPrisma() {
  const db = {
    bottleWallet: { update: jest.fn() },
    customer: { update: jest.fn(), findFirst: jest.fn() },
    transaction: {
      findFirst: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
  // $transaction passes the same mock as the `tx` arg so all inner calls resolve
  (db as any).$transaction = jest.fn().mockImplementation(
    (fn: (tx: typeof db) => unknown) => fn(db),
  );
  return db;
}

const mockCache = {
  invalidateCustomerWallets: jest.fn(),
  invalidateVendorEntity: jest.fn(),
};

// ── Shared test data ──────────────────────────────────────────────────────────
const BASE = {
  vendorId: 'vendor-1',
  customerId: 'customer-1',
  productId: 'product-1',
  dailySheetId: 'sheet-1',
  dailySheetItemId: 'item-1',
  pricePerBottle: 100,
};

describe('LedgerService.recordDelivery — idempotency', () => {
  let service: LedgerService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheInvalidationService, useValue: mockCache },
      ],
    }).compile();

    service = module.get<LedgerService>(LedgerService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── 1. First submit ──────────────────────────────────────────────────────────
  describe('first submit (no existing transactions)', () => {
    beforeEach(() => {
      // No existing delivery transaction for this item
      mockPrisma.transaction.findFirst.mockResolvedValue(null);
    });

    it('posts DELIVERY and PAYMENT transactions with dailySheetItemId', async () => {
      await service.recordDelivery({
        ...BASE,
        filledDropped: 2,
        emptyReceived: 1,
        cashCollected: 200,
      });

      const creates = mockPrisma.transaction.create.mock.calls;
      expect(creates).toHaveLength(2);

      const [deliveryData, paymentData] = creates.map((c: any) => c[0].data);
      expect(deliveryData.type).toBe(TransactionType.DELIVERY);
      expect(deliveryData.dailySheetItemId).toBe('item-1');
      expect(deliveryData.filledDropped).toBe(2);
      expect(deliveryData.emptyReceived).toBe(1);
      expect(deliveryData.bottleCount).toBe(1); // 2 - 1
      expect(deliveryData.amount).toBe(200);    // 2 * 100

      expect(paymentData.type).toBe(TransactionType.PAYMENT);
      expect(paymentData.dailySheetItemId).toBe('item-1');
      expect(paymentData.amount).toBe(-200);
    });

    it('increments bottle wallet by (filledDropped - emptyReceived)', async () => {
      await service.recordDelivery({ ...BASE, filledDropped: 3, emptyReceived: 1, cashCollected: 0 });

      expect(mockPrisma.bottleWallet.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { balance: { increment: 2 } } }),
      );
    });

    it('increments financialBalance by (charge - cashCollected)', async () => {
      await service.recordDelivery({ ...BASE, filledDropped: 2, emptyReceived: 0, cashCollected: 100 });
      // charge = 2*100 = 200; cashCollected = 100 → net = 100
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { financialBalance: { increment: 100 } } }),
      );
    });

    it('does not create PAYMENT transaction when cashCollected is 0', async () => {
      await service.recordDelivery({ ...BASE, filledDropped: 1, emptyReceived: 0, cashCollected: 0 });

      const creates = mockPrisma.transaction.create.mock.calls;
      expect(creates).toHaveLength(1);
      expect(creates[0][0].data.type).toBe(TransactionType.DELIVERY);
    });
  });

  // ── 2. Edit: cash 300 → 400 ──────────────────────────────────────────────────
  describe('edit: cash 300 → 400 (same qty)', () => {
    beforeEach(() => {
      // Existing ledger from first submit: 2 bottles @100, cash 300
      mockPrisma.transaction.findFirst
        .mockResolvedValueOnce({
          id: 'tx-delivery-old',
          type: TransactionType.DELIVERY,
          bottleCount: 2,
          amount: 200, // 2 * 100
        })
        .mockResolvedValueOnce({
          id: 'tx-payment-old',
          type: TransactionType.PAYMENT,
          amount: -300, // old cashCollected
        });
    });

    it('applies only the cash delta to financialBalance — no double-post', async () => {
      await service.recordDelivery({
        ...BASE,
        filledDropped: 2,
        emptyReceived: 0,
        cashCollected: 400, // increased from 300
      });

      // oldFinancialEffect = 200 + (-300) = -100
      // newFinancialEffect = (2*100) - 400 = -200
      // delta = -200 - (-100) = -100  → balance decreases by 100
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { financialBalance: { increment: -100 } } }),
      );
    });

    it('does not touch bottle wallet when quantity is unchanged', async () => {
      await service.recordDelivery({
        ...BASE,
        filledDropped: 2,
        emptyReceived: 0,
        cashCollected: 400,
      });

      expect(mockPrisma.bottleWallet.update).not.toHaveBeenCalled();
    });

    it('deletes old transactions and creates fresh replacements', async () => {
      await service.recordDelivery({
        ...BASE,
        filledDropped: 2,
        emptyReceived: 0,
        cashCollected: 400,
      });

      expect(mockPrisma.transaction.deleteMany).toHaveBeenCalledWith({
        where: { dailySheetItemId: 'item-1' },
      });

      const creates = mockPrisma.transaction.create.mock.calls.map((c: any) => c[0].data);
      expect(creates).toHaveLength(2);
      const payment = creates.find((d: any) => d.type === TransactionType.PAYMENT);
      expect(payment?.amount).toBe(-400);
    });

    it('produces exactly one DELIVERY transaction after re-edit', async () => {
      await service.recordDelivery({
        ...BASE,
        filledDropped: 2,
        emptyReceived: 0,
        cashCollected: 400,
      });

      const deliveryCreates = mockPrisma.transaction.create.mock.calls
        .map((c: any) => c[0].data)
        .filter((d: any) => d.type === TransactionType.DELIVERY);
      expect(deliveryCreates).toHaveLength(1);
    });
  });

  // ── 3. Edit: quantity + cash combination ─────────────────────────────────────
  describe('edit: filledDropped 2→3, emptyReceived 0→1, cash 200→300', () => {
    beforeEach(() => {
      // Previous: 2 bottles @100, 0 empties, cash 200
      mockPrisma.transaction.findFirst
        .mockResolvedValueOnce({
          id: 'tx-d',
          type: TransactionType.DELIVERY,
          bottleCount: 2, // 2 filled - 0 empty
          amount: 200,    // 2 * 100
        })
        .mockResolvedValueOnce({
          id: 'tx-p',
          type: TransactionType.PAYMENT,
          amount: -200,
        });
    });

    it('correctly computes bottle delta (old:2, new:2 → no wallet update)', async () => {
      await service.recordDelivery({
        ...BASE,
        filledDropped: 3,
        emptyReceived: 1, // net = 2, same as before
        cashCollected: 300,
      });

      expect(mockPrisma.bottleWallet.update).not.toHaveBeenCalled();
    });

    it('correctly computes financial delta (old effect:0, new effect:0 → no balance update)', async () => {
      await service.recordDelivery({
        ...BASE,
        filledDropped: 3,   // charge = 300
        emptyReceived: 1,
        cashCollected: 300, // newFinancialEffect = 300 - 300 = 0
      });

      // oldFinancialEffect = 200 + (-200) = 0 → delta = 0
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
    });

    it('replaces transactions with new delivery values', async () => {
      await service.recordDelivery({
        ...BASE,
        filledDropped: 3,
        emptyReceived: 1,
        cashCollected: 300,
      });

      expect(mockPrisma.transaction.deleteMany).toHaveBeenCalledWith({
        where: { dailySheetItemId: 'item-1' },
      });

      const creates = mockPrisma.transaction.create.mock.calls.map((c: any) => c[0].data);
      const delivery = creates.find((d: any) => d.type === TransactionType.DELIVERY);
      expect(delivery?.filledDropped).toBe(3);
      expect(delivery?.emptyReceived).toBe(1);
      expect(delivery?.bottleCount).toBe(2);
      expect(delivery?.amount).toBe(300); // 3 * 100

      const payment = creates.find((d: any) => d.type === TransactionType.PAYMENT);
      expect(payment?.amount).toBe(-300);
    });
  });

  // ── 4. No duplicates after identical re-submit ───────────────────────────────
  describe('idempotency: identical back-to-back submits', () => {
    it('leaves balances unchanged and replaces (not adds) transactions on second call', async () => {
      // First call sees no existing transaction
      // Second call sees the delivery from the first call
      mockPrisma.transaction.findFirst
        .mockResolvedValueOnce(null) // first call: no existing delivery
        // second call
        .mockResolvedValueOnce({
          id: 'tx-d',
          type: TransactionType.DELIVERY,
          bottleCount: 1,
          amount: 100,
        })
        .mockResolvedValueOnce(null); // second call: no payment (cashCollected was 0)

      const params = { ...BASE, filledDropped: 1, emptyReceived: 0, cashCollected: 0 };

      await service.recordDelivery(params); // first submit
      await service.recordDelivery(params); // identical re-submit

      // Wallet incremented only on the first call (delta = 0 on second)
      const walletIncrements = mockPrisma.bottleWallet.update.mock.calls;
      expect(walletIncrements).toHaveLength(1);

      // Balance incremented only on the first call
      const balanceIncrements = mockPrisma.customer.update.mock.calls;
      expect(balanceIncrements).toHaveLength(1);

      // Transactions: first call creates 1 DELIVERY; second call deletes + re-creates 1 DELIVERY
      // Total creates = 2, but old was deleted — no duplication persists in DB
      const deliveryCreates = mockPrisma.transaction.create.mock.calls
        .map((c: any) => c[0].data)
        .filter((d: any) => d.type === TransactionType.DELIVERY);
      expect(deliveryCreates).toHaveLength(2); // one per call (second replaced the first)
      expect(mockPrisma.transaction.deleteMany).toHaveBeenCalledTimes(1);
    });
  });
});
