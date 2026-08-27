import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { PaymentEditReason, TransactionType } from '@prisma/client';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '@water-supply-crm/types';

// ── Minimal Prisma mock ────────────────────────────────────────────────────────
// $transaction runs the callback with the SAME mock object, so every inner
// call (updateMany / deleteMany / findUnique / customer.update) resolves.
function buildMockPrisma() {
  const db = {
    customer: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
    },
    transaction: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn() as jest.Mock,
  };
  // $transaction runs the callback with the same mock object so all inner calls resolve.
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  return db;
}

function buildMockCache() {
  return {
    invalidateVendorEntity: jest.fn().mockResolvedValue(undefined),
    invalidateOverview: jest.fn().mockResolvedValue(undefined),
    invalidateCustomerWallets: jest.fn().mockResolvedValue(undefined),
    invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
  };
}

// ── Shared test data ──────────────────────────────────────────────────────────
const VENDOR_ID = 'vendor-1';
const CUSTOMER_ID = 'customer-1';
const TX_ID = 'tx-pay-1';
const EXPECTED_UPDATED_AT = '2026-08-27T10:00:00.000Z';
const LAST_EDITED_AT = new Date('2026-08-27T12:34:56.000Z');
const MOCKED_NEW_BALANCE = 1500;

const USER: AuthUser = {
  userId: 'user-1',
  email: 'cashier@example.com',
  name: 'Cashier Bob',
  role: 'STAFF',
  vendorId: VENDOR_ID,
  customerId: null,
};

/** The row `transaction.findFirst` returns before the write. */
function makeExistingTx(overrides: Record<string, unknown> = {}) {
  return {
    id: TX_ID,
    vendorId: VENDOR_ID,
    customerId: CUSTOMER_ID,
    type: TransactionType.PAYMENT,
    amount: -2500,
    description: 'Payment received',
    dailySheetId: null,
    dailySheetItemId: null,
    paymentRequestId: null,
    createdAt: new Date('2026-08-20T09:00:00.000Z'),
    customer: { id: CUSTOMER_ID, name: 'Ahmed', phoneNumber: '923001234567' },
    ...overrides,
  };
}

/** The row `transaction.findUnique` returns after the updateMany (editPayment). */
function makeUpdatedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TX_ID,
    amount: -2000,
    description: 'Payment received',
    lastEditedAt: LAST_EDITED_AT,
    customer: {
      id: CUSTOMER_ID,
      name: 'Ahmed',
      phoneNumber: '923001234567',
      financialBalance: MOCKED_NEW_BALANCE,
      ...(overrides.customer as object | undefined),
    },
    ...overrides,
  };
}

describe('LedgerService — editPayment / deletePayment', () => {
  let service: LedgerService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;
  let mockCache: ReturnType<typeof buildMockCache>;
  let mockNotifications: { queueWhatsApp: jest.Mock };
  let mockAudit: { log: jest.Mock };

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();
    mockCache = buildMockCache();
    mockNotifications = { queueWhatsApp: jest.fn().mockResolvedValue(undefined) };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheInvalidationService, useValue: mockCache },
        { provide: NotificationService, useValue: mockNotifications },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<LedgerService>(LedgerService);
  });

  afterEach(() => jest.clearAllMocks());

  // ══════════════════════════════════════════════════════════════════════════
  // editPayment — balance delta
  // ══════════════════════════════════════════════════════════════════════════
  describe('editPayment — balance delta', () => {
    function primeHappyPath(existingAmount: number, updatedAmount: number) {
      mockPrisma.transaction.findFirst.mockResolvedValue(
        makeExistingTx({ amount: existingAmount }),
      );
      mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.transaction.findUnique.mockResolvedValue(
        makeUpdatedRow({ amount: updatedAmount }),
      );
      mockPrisma.customer.findUnique.mockResolvedValue({
        financialBalance: MOCKED_NEW_BALANCE,
      });
    }

    it('2500 → 2000: increments financialBalance by +500, stores amount -2000', async () => {
      primeHappyPath(-2500, -2000);

      const result = await service.editPayment(
        VENDOR_ID,
        TX_ID,
        {
          amount: 2000,
          reason: PaymentEditReason.WRONG_AMOUNT,
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
        },
        USER,
      );

      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CUSTOMER_ID },
          data: { financialBalance: { increment: 500 } },
        }),
      );
      expect(mockPrisma.transaction.updateMany.mock.calls[0][0].data.amount).toBe(
        -2000,
      );
      expect(result).toEqual({
        transaction: expect.any(Object),
        previousAmount: 2500,
        newAmount: 2000,
        delta: 500,
        newBalance: MOCKED_NEW_BALANCE,
      });
    });

    it('2000 → 3000: increments financialBalance by -1000, stores amount -3000', async () => {
      primeHappyPath(-2000, -3000);

      const result = await service.editPayment(
        VENDOR_ID,
        TX_ID,
        {
          amount: 3000,
          reason: PaymentEditReason.CASH_RECOUNTED,
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
        },
        USER,
      );

      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { financialBalance: { increment: -1000 } },
        }),
      );
      expect(mockPrisma.transaction.updateMany.mock.calls[0][0].data.amount).toBe(
        -3000,
      );
      expect(result.delta).toBe(-1000);
    });

    it('delta 0 (description-only edit): no customer.update, no WhatsApp, but updateMany + audit still run', async () => {
      primeHappyPath(-2000, -2000);

      await service.editPayment(
        VENDOR_ID,
        TX_ID,
        {
          amount: 2000,
          description: 'Corrected note only',
          reason: PaymentEditReason.DUPLICATE_ENTRY,
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
        },
        USER,
      );

      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
      expect(mockNotifications.queueWhatsApp).not.toHaveBeenCalled();
      expect(mockPrisma.transaction.updateMany).toHaveBeenCalledTimes(1);
      const updateData = mockPrisma.transaction.updateMany.mock.calls[0][0].data;
      expect(updateData.description).toBe('Corrected note only');
      expect(updateData.lastEditedAt).toBeInstanceOf(Date);
      expect(updateData.lastEditedById).toBe(USER.userId);
      expect(mockAudit.log).toHaveBeenCalledTimes(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // editPayment — guards
  // ══════════════════════════════════════════════════════════════════════════
  describe('editPayment — guards', () => {
    const input = {
      amount: 1000,
      reason: PaymentEditReason.WRONG_AMOUNT,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    };

    async function expectConflict(txOverrides: Record<string, unknown>) {
      mockPrisma.transaction.findFirst.mockResolvedValue(
        makeExistingTx(txOverrides),
      );
      await expect(
        service.editPayment(VENDOR_ID, TX_ID, input, USER),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
    }

    it('rejects a non-PAYMENT transaction', async () => {
      await expectConflict({ type: TransactionType.DELIVERY });
    });

    it('rejects a payment linked to a daily sheet', async () => {
      await expectConflict({ dailySheetId: 'sheet-1' });
    });

    it('rejects a payment linked to a daily sheet item', async () => {
      await expectConflict({ dailySheetItemId: 'item-1' });
    });

    it('rejects a payment sourced from a payment request', async () => {
      await expectConflict({ paymentRequestId: 'pr-1' });
    });

    it('throws NotFoundException when findFirst returns null, and scopes the lookup by vendorId', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(null);

      await expect(
        service.editPayment(VENDOR_ID, TX_ID, input, USER),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockPrisma.transaction.findFirst.mock.calls[0][0].where).toEqual(
        expect.objectContaining({ id: TX_ID, vendorId: VENDOR_ID }),
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // editPayment — optimistic lock
  // ══════════════════════════════════════════════════════════════════════════
  describe('editPayment — optimistic lock', () => {
    it('throws ConflictException when updateMany claims 0 rows; customer.update not called', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(makeExistingTx());
      mockPrisma.transaction.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.editPayment(
          VENDOR_ID,
          TX_ID,
          {
            amount: 2000,
            reason: PaymentEditReason.WRONG_AMOUNT,
            expectedUpdatedAt: EXPECTED_UPDATED_AT,
          },
          USER,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('scopes updateMany by id + vendorId + expectedUpdatedAt', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(makeExistingTx());
      mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.transaction.findUnique.mockResolvedValue(makeUpdatedRow());

      await service.editPayment(
        VENDOR_ID,
        TX_ID,
        {
          amount: 2000,
          reason: PaymentEditReason.WRONG_AMOUNT,
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
        },
        USER,
      );

      const where = mockPrisma.transaction.updateMany.mock.calls[0][0].where;
      expect(where.id).toBe(TX_ID);
      expect(where.vendorId).toBe(VENDOR_ID);
      expect(where.updatedAt).toBeInstanceOf(Date);
      expect((where.updatedAt as Date).toISOString()).toBe(EXPECTED_UPDATED_AT);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // editPayment — audit payload
  // ══════════════════════════════════════════════════════════════════════════
  describe('editPayment — audit payload', () => {
    it('logs a single UPDATE entry with before/after amounts and edit reason', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(
        makeExistingTx({ amount: -2500, description: 'Old note' }),
      );
      mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.transaction.findUnique.mockResolvedValue(
        makeUpdatedRow({ amount: -2000 }),
      );

      await service.editPayment(
        VENDOR_ID,
        TX_ID,
        {
          amount: 2000,
          description: 'New note',
          reason: PaymentEditReason.OTHER,
          reasonNote: 'manager approved recount',
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
        },
        USER,
      );

      expect(mockAudit.log).toHaveBeenCalledTimes(1);
      const payload = mockAudit.log.mock.calls[0][0];
      expect(payload).toEqual(
        expect.objectContaining({
          vendorId: VENDOR_ID,
          userId: USER.userId,
          action: 'UPDATE',
          entity: 'Transaction',
          entityId: TX_ID,
        }),
      );
      expect(payload.changes.before.amount).toBe(2500);
      expect(payload.changes.after.amount).toBe(2000);
      expect(payload.changes.after.editReason).toBe(PaymentEditReason.OTHER);
      expect(payload.changes.after.editReasonNote).toBe('manager approved recount');
    });

    it('records editReasonNote as null when none supplied', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(makeExistingTx());
      mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.transaction.findUnique.mockResolvedValue(makeUpdatedRow());

      await service.editPayment(
        VENDOR_ID,
        TX_ID,
        {
          amount: 2000,
          reason: PaymentEditReason.WRONG_AMOUNT,
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
        },
        USER,
      );

      expect(mockAudit.log.mock.calls[0][0].changes.after.editReasonNote).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // editPayment — WhatsApp
  // ══════════════════════════════════════════════════════════════════════════
  describe('editPayment — WhatsApp', () => {
    it('queues a correction notice with the right idempotency-key prefix and meta when delta ≠ 0 and phone present', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(
        makeExistingTx({ amount: -2500 }),
      );
      mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.transaction.findUnique.mockResolvedValue(
        makeUpdatedRow({ amount: -2000 }),
      );

      await service.editPayment(
        VENDOR_ID,
        TX_ID,
        {
          amount: 2000,
          reason: PaymentEditReason.WRONG_AMOUNT,
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
        },
        USER,
      );

      expect(mockNotifications.queueWhatsApp).toHaveBeenCalledTimes(1);
      const [phone, , idemKey, meta] = mockNotifications.queueWhatsApp.mock.calls[0];
      expect(phone).toBe('923001234567');
      expect(idemKey).toEqual(
        expect.stringContaining(`ntf:payment-correction:${TX_ID}:`),
      );
      expect(idemKey).toBe(
        `ntf:payment-correction:${TX_ID}:${LAST_EDITED_AT.getTime()}:wa`,
      );
      expect(meta).toEqual(
        expect.objectContaining({
          type: 'PAYMENT_RECEIVED',
          recipientType: 'CUSTOMER',
          recipientId: CUSTOMER_ID,
          vendorId: VENDOR_ID,
        }),
      );
    });

    it('does not queue WhatsApp when the customer has no phone, but still audits + updates balance', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(
        makeExistingTx({
          amount: -2500,
          customer: { id: CUSTOMER_ID, name: 'Ahmed', phoneNumber: null },
        }),
      );
      mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.transaction.findUnique.mockResolvedValue(
        makeUpdatedRow({
          amount: -2000,
          customer: {
            id: CUSTOMER_ID,
            name: 'Ahmed',
            phoneNumber: null,
            financialBalance: MOCKED_NEW_BALANCE,
          },
        }),
      );

      await service.editPayment(
        VENDOR_ID,
        TX_ID,
        {
          amount: 2000,
          reason: PaymentEditReason.WRONG_AMOUNT,
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
        },
        USER,
      );

      expect(mockNotifications.queueWhatsApp).not.toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledTimes(1);
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { financialBalance: { increment: 500 } } }),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // editPayment — cache
  // ══════════════════════════════════════════════════════════════════════════
  describe('editPayment — cache invalidation', () => {
    it('calls all 4 cache methods once each, scoped to vendor (+ customer for wallets)', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(makeExistingTx());
      mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.transaction.findUnique.mockResolvedValue(makeUpdatedRow());

      await service.editPayment(
        VENDOR_ID,
        TX_ID,
        {
          amount: 2000,
          reason: PaymentEditReason.WRONG_AMOUNT,
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
        },
        USER,
      );

      expect(mockCache.invalidateVendorEntity).toHaveBeenCalledTimes(1);
      expect(mockCache.invalidateVendorEntity).toHaveBeenCalledWith(
        VENDOR_ID,
        expect.anything(),
      );
      expect(mockCache.invalidateOverview).toHaveBeenCalledTimes(1);
      expect(mockCache.invalidateOverview).toHaveBeenCalledWith(VENDOR_ID);
      expect(mockCache.invalidateCustomerWallets).toHaveBeenCalledTimes(1);
      expect(mockCache.invalidateCustomerWallets).toHaveBeenCalledWith(
        VENDOR_ID,
        CUSTOMER_ID,
      );
      expect(mockCache.invalidateAnalytics).toHaveBeenCalledTimes(1);
      expect(mockCache.invalidateAnalytics).toHaveBeenCalledWith(VENDOR_ID);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // editPayment — response shape
  // ══════════════════════════════════════════════════════════════════════════
  describe('editPayment — response shape', () => {
    it('returns exactly { transaction, previousAmount, newAmount, delta, newBalance }', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(
        makeExistingTx({ amount: -2500 }),
      );
      mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.transaction.findUnique.mockResolvedValue(
        makeUpdatedRow({ amount: -2000 }),
      );

      const result = await service.editPayment(
        VENDOR_ID,
        TX_ID,
        {
          amount: 2000,
          reason: PaymentEditReason.WRONG_AMOUNT,
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
        },
        USER,
      );

      expect(Object.keys(result).sort()).toEqual(
        ['delta', 'newAmount', 'newBalance', 'previousAmount', 'transaction'].sort(),
      );
      expect(result.newBalance).toBe(MOCKED_NEW_BALANCE);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deletePayment
  // ══════════════════════════════════════════════════════════════════════════
  describe('deletePayment', () => {
    const input = {
      reason: PaymentEditReason.DUPLICATE_ENTRY,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    };

    function primeHappyPath(existingAmount = -2000) {
      mockPrisma.transaction.findFirst.mockResolvedValue(
        makeExistingTx({ amount: existingAmount }),
      );
      mockPrisma.transaction.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.customer.findUnique.mockResolvedValue({
        financialBalance: MOCKED_NEW_BALANCE,
      });
    }

    it('happy path: reverses balance, deletes with optimistic-lock where, returns summary', async () => {
      primeHappyPath(-2000);

      const result = await service.deletePayment(VENDOR_ID, TX_ID, input, USER);

      const where = mockPrisma.transaction.deleteMany.mock.calls[0][0].where;
      expect(where.id).toBe(TX_ID);
      expect(where.vendorId).toBe(VENDOR_ID);
      expect(where.updatedAt).toBeInstanceOf(Date);

      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CUSTOMER_ID },
          data: { financialBalance: { increment: 2000 } },
        }),
      );
      expect(result).toEqual({
        transactionId: TX_ID,
        reversedAmount: 2000,
        newBalance: MOCKED_NEW_BALANCE,
      });
    });

    describe('guards', () => {
      async function expectConflict(txOverrides: Record<string, unknown>) {
        mockPrisma.transaction.findFirst.mockResolvedValue(
          makeExistingTx(txOverrides),
        );
        await expect(
          service.deletePayment(VENDOR_ID, TX_ID, input, USER),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
        expect(mockPrisma.customer.update).not.toHaveBeenCalled();
      }

      it('rejects a non-PAYMENT transaction', async () => {
        await expectConflict({ type: TransactionType.ADJUSTMENT });
      });
      it('rejects a payment linked to a daily sheet', async () => {
        await expectConflict({ dailySheetId: 'sheet-1' });
      });
      it('rejects a payment linked to a daily sheet item', async () => {
        await expectConflict({ dailySheetItemId: 'item-1' });
      });
      it('rejects a payment sourced from a payment request', async () => {
        await expectConflict({ paymentRequestId: 'pr-1' });
      });
      it('throws NotFoundException when findFirst returns null', async () => {
        mockPrisma.transaction.findFirst.mockResolvedValue(null);
        await expect(
          service.deletePayment(VENDOR_ID, TX_ID, input, USER),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(mockPrisma.transaction.findFirst.mock.calls[0][0].where).toEqual(
          expect.objectContaining({ id: TX_ID, vendorId: VENDOR_ID }),
        );
      });
    });

    it('optimistic lock: deleteMany claims 0 rows → ConflictException, customer.update not called', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(makeExistingTx());
      mockPrisma.transaction.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deletePayment(VENDOR_ID, TX_ID, input, USER),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('audit: logs a DELETE entry carrying the delete reason', async () => {
      primeHappyPath(-2000);

      await service.deletePayment(
        VENDOR_ID,
        TX_ID,
        {
          reason: PaymentEditReason.OTHER,
          reasonNote: 'entered twice by mistake',
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
        },
        USER,
      );

      expect(mockAudit.log).toHaveBeenCalledTimes(1);
      const payload = mockAudit.log.mock.calls[0][0];
      expect(payload).toEqual(
        expect.objectContaining({
          action: 'DELETE',
          entity: 'Transaction',
          entityId: TX_ID,
        }),
      );
      expect(payload.changes.before.amount).toBe(2000);
      expect(payload.changes.after.deleteReason).toBe(PaymentEditReason.OTHER);
      expect(payload.changes.after.deleteReasonNote).toBe('entered twice by mistake');
    });

    it('WhatsApp: queues a reversal notice with the static idempotency key when phone present', async () => {
      primeHappyPath(-2000);

      await service.deletePayment(VENDOR_ID, TX_ID, input, USER);

      expect(mockNotifications.queueWhatsApp).toHaveBeenCalledTimes(1);
      const [phone, , idemKey, meta] = mockNotifications.queueWhatsApp.mock.calls[0];
      expect(phone).toBe('923001234567');
      expect(idemKey).toBe(`ntf:payment-reversal:${TX_ID}:wa`);
      expect(meta).toEqual(
        expect.objectContaining({
          type: 'PAYMENT_RECEIVED',
          recipientType: 'CUSTOMER',
          recipientId: CUSTOMER_ID,
          vendorId: VENDOR_ID,
        }),
      );
    });

    it('WhatsApp: not queued when the customer has no phone, but balance + audit still happen', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(
        makeExistingTx({
          amount: -2000,
          customer: { id: CUSTOMER_ID, name: 'Ahmed', phoneNumber: '' },
        }),
      );
      mockPrisma.transaction.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.customer.findUnique.mockResolvedValue({
        financialBalance: MOCKED_NEW_BALANCE,
      });

      await service.deletePayment(VENDOR_ID, TX_ID, input, USER);

      expect(mockNotifications.queueWhatsApp).not.toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledTimes(1);
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { financialBalance: { increment: 2000 } } }),
      );
    });

    it('cache: calls all 4 invalidation methods once each', async () => {
      primeHappyPath(-2000);

      await service.deletePayment(VENDOR_ID, TX_ID, input, USER);

      expect(mockCache.invalidateVendorEntity).toHaveBeenCalledTimes(1);
      expect(mockCache.invalidateOverview).toHaveBeenCalledWith(VENDOR_ID);
      expect(mockCache.invalidateCustomerWallets).toHaveBeenCalledWith(
        VENDOR_ID,
        CUSTOMER_ID,
      );
      expect(mockCache.invalidateAnalytics).toHaveBeenCalledWith(VENDOR_ID);
    });
  });
});
