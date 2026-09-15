import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { DeliveryStatus } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { DeliveryRepricingService } from './delivery-repricing.service';
import { LedgerService } from '../transaction/ledger.service';
import { AuditService } from '../audit/audit.service';

/**
 * Unit tests: DeliveryRepricingService.bulkReprice — Bulk Closed Delivery
 * Repricing (POST /daily-sheets/items/bulk-reprice).
 *
 * Deliberately separate from correct-closed-delivery.service.spec.ts: this
 * flow never changes quantities, only pricePerBottle, across N items for one
 * customer in a single atomic transaction. The per-item balance math itself
 * (signed delta, zero bottle-wallet effect for a pure reprice) is
 * LedgerService's job and is covered by ledger.service.spec.ts — here we only
 * assert this service calls it correctly, once per item, and that the whole
 * batch is genuinely atomic (all-or-nothing).
 */
describe('DeliveryRepricingService.bulkReprice', () => {
  let service: DeliveryRepricingService;
  let mockPrisma: any;
  let mockLedger: any;
  let mockAudit: any;
  let mockCache: any;

  const VENDOR_ID = 'vendor-001';
  const OTHER_VENDOR = 'vendor-999';
  const CUSTOMER_ID = 'customer-001';
  const OTHER_CUSTOMER = 'customer-002';
  const PRODUCT_ID = 'product-001';
  const SHEET_ID = 'sheet-001';
  const SHEET_DATE_1 = new Date('2026-09-01T00:00:00.000Z');
  const SHEET_DATE_2 = new Date('2026-09-02T00:00:00.000Z');

  const ADMIN_USER: AuthUser = {
    userId: 'admin-1',
    email: 'a@example.com',
    name: 'Admin',
    role: 'VENDOR_ADMIN' as AuthUser['role'],
    vendorId: VENDOR_ID,
    customerId: null,
  };

  const dto = {
    dailySheetItemIds: ['item-001', 'item-002'],
    newPricePerBottle: 200,
    reason: 'Customer refused the Sept 1 rate increase; management approved keeping the old rate',
  };

  function buildItem(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      dailySheetId: SHEET_ID,
      customerId: CUSTOMER_ID,
      productId: PRODUCT_ID,
      filledDropped: 5,
      emptyReceived: 3,
      filledReceived: 0,
      cashCollected: 0,
      pricePerBottle: 220,
      status: DeliveryStatus.COMPLETED,
      voidedAt: null,
      dailySheet: { vendorId: VENDOR_ID, isClosed: true, date: SHEET_DATE_1 },
      ...overrides,
    };
  }

  function wireTx(freshByItemId: Record<string, { status: DeliveryStatus; voidedAt: Date | null }> = {}) {
    let batchCounter = 0;
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      deliveryRepricingBatch: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          batchCounter += 1;
          return Promise.resolve({ id: `batch-${batchCounter}`, ...data });
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) =>
          Promise.resolve({ id: where.id, ...data }),
        ),
      },
      dailySheetItem: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(
            freshByItemId[where.id] ?? { status: DeliveryStatus.COMPLETED, voidedAt: null },
          ),
        ),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data)),
      },
      customer: { findUnique: jest.fn().mockResolvedValue({ financialBalance: 1000 }) },
      deliveryRepricingItem: {
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data)),
      },
    };
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
    return tx;
  }

  beforeEach(async () => {
    mockLedger = { recordDelivery: jest.fn().mockResolvedValue({ success: true }) };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockCache = {
      invalidateDailyDashboard: jest.fn().mockResolvedValue(undefined),
      invalidateOverview: jest.fn().mockResolvedValue(undefined),
      invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
    };
    mockPrisma = {
      dailySheetItem: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryRepricingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: mockLedger },
        { provide: AuditService, useValue: mockAudit },
        { provide: CacheInvalidationService, useValue: mockCache },
      ],
    }).compile();

    service = module.get<DeliveryRepricingService>(DeliveryRepricingService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Happy path ────────────────────────────────────────────────────────────
  it('locks each row, deltas the ledger per item at the new rate, updates items, creates batch+item audit rows, invalidates caches', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([
      buildItem('item-001'),
      buildItem('item-002', { dailySheet: { vendorId: VENDOR_ID, isClosed: true, date: SHEET_DATE_2 } }),
    ]);
    const tx = wireTx();

    const result = await service.bulkReprice(ADMIN_USER, dto);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

    // Row lock per item, before the in-txn re-read.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);

    // Ledger delta called once per item, new price, quantities/cash untouched.
    expect(mockLedger.recordDelivery).toHaveBeenCalledTimes(2);
    for (const [ledgerArg, txArg] of mockLedger.recordDelivery.mock.calls) {
      expect(ledgerArg).toEqual(
        expect.objectContaining({
          vendorId: VENDOR_ID,
          customerId: CUSTOMER_ID,
          productId: PRODUCT_ID,
          dailySheetId: SHEET_ID,
          filledDropped: 5,
          emptyReceived: 3,
          filledReceived: 0,
          cashCollected: 0,
          pricePerBottle: 200,
        }),
      );
      expect(txArg).toBe(tx);
    }

    // Item updates: new price + isRepriced marker — NOT isCorrection/correctionNote
    // (that pair is reserved for the separate mistake-correction flow).
    expect(tx.dailySheetItem.update).toHaveBeenCalledTimes(2);
    for (const call of tx.dailySheetItem.update.mock.calls) {
      expect(call[0].data).toEqual(
        expect.objectContaining({
          pricePerBottle: 200,
          isRepriced: true,
          editCount: { increment: 1 },
          financialBalanceAfter: 1000,
        }),
      );
      expect(call[0].data.repricedAt).toBeInstanceOf(Date);
      expect(call[0].data).not.toHaveProperty('isCorrection');
      expect(call[0].data).not.toHaveProperty('correctionNote');
    }

    // Per-item repricing audit rows, correct old/new amounts (qty 5 * 220 vs 5 * 200).
    expect(tx.deliveryRepricingItem.create).toHaveBeenCalledTimes(2);
    expect(tx.deliveryRepricingItem.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        dailySheetItemId: 'item-001',
        quantity: 5,
        oldPricePerBottle: 220,
        newPricePerBottle: 200,
        oldAmount: 1100,
        newAmount: 1000,
        difference: -100,
      }),
    );

    // Batch: created once, updated with the summed total difference (-200 across both items).
    expect(tx.deliveryRepricingBatch.create).toHaveBeenCalledTimes(1);
    expect(tx.deliveryRepricingBatch.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        vendorId: VENDOR_ID,
        customerId: CUSTOMER_ID,
        newPricePerBottle: 200,
        reason: dto.reason,
        itemCount: 2,
        createdById: ADMIN_USER.userId,
        createdByName: ADMIN_USER.name,
      }),
    );
    expect(tx.deliveryRepricingBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { totalDifference: -200 } }),
    );

    // One aggregate audit row (not N), matching the bulk-import/bulk-schedule convention.
    expect(mockAudit.log).toHaveBeenCalledTimes(1);
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: VENDOR_ID,
        userId: ADMIN_USER.userId,
        action: 'BULK_CLOSED_DELIVERY_REPRICED',
        entity: 'DeliveryRepricingBatch',
        changes: expect.objectContaining({
          after: expect.objectContaining({
            customerId: CUSTOMER_ID,
            newPricePerBottle: 200,
            reason: dto.reason,
            itemCount: 2,
            totalDifference: -200,
          }),
        }),
      }),
    );

    // Cache invalidation: once per distinct sheet-date touched, plus one overview/analytics.
    expect(mockCache.invalidateDailyDashboard).toHaveBeenCalledTimes(2);
    expect(mockCache.invalidateDailyDashboard).toHaveBeenCalledWith(VENDOR_ID, '2026-09-01');
    expect(mockCache.invalidateDailyDashboard).toHaveBeenCalledWith(VENDOR_ID, '2026-09-02');
    expect(mockCache.invalidateOverview).toHaveBeenCalledTimes(1);
    expect(mockCache.invalidateAnalytics).toHaveBeenCalledTimes(1);

    expect(result).toEqual(
      expect.objectContaining({ customerId: CUSTOMER_ID, itemCount: 2, totalDifference: -200 }),
    );
  });

  it('quantities and cashCollected are never part of the ledger call or the item update', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([
      buildItem('item-001'),
      buildItem('item-002'),
    ]);
    wireTx();

    await service.bulkReprice(ADMIN_USER, dto);

    for (const call of mockLedger.recordDelivery.mock.calls) {
      expect(call[0].filledDropped).toBe(5);
      expect(call[0].emptyReceived).toBe(3);
      expect(call[0].filledReceived).toBe(0);
      expect(call[0].cashCollected).toBe(0);
    }
  });

  // ── Rejections — whole batch fails together, nothing mutated ──────────────
  it('items from different customers → BadRequestException, $transaction never opened', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([
      buildItem('item-001', { customerId: CUSTOMER_ID }),
      buildItem('item-002', { customerId: OTHER_CUSTOMER }),
    ]);

    await expect(service.bulkReprice(ADMIN_USER, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('an item on a still-OPEN sheet → ConflictException, $transaction never opened', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([
      buildItem('item-001'),
      buildItem('item-002', { dailySheet: { vendorId: VENDOR_ID, isClosed: false, date: SHEET_DATE_1 } }),
    ]);

    await expect(service.bulkReprice(ADMIN_USER, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('a voided item → ConflictException, $transaction never opened', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([
      buildItem('item-001'),
      buildItem('item-002', { voidedAt: new Date() }),
    ]);

    await expect(service.bulkReprice(ADMIN_USER, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('a non-terminal-status item (e.g. PENDING) → BadRequestException, $transaction never opened', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([
      buildItem('item-001'),
      buildItem('item-002', { status: DeliveryStatus.PENDING }),
    ]);

    await expect(service.bulkReprice(ADMIN_USER, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('an item belonging to another vendor → NotFoundException (no cross-vendor existence leak)', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([
      buildItem('item-001'),
      buildItem('item-002', { dailySheet: { vendorId: OTHER_VENDOR, isClosed: true, date: SHEET_DATE_1 } }),
    ]);

    await expect(service.bulkReprice(ADMIN_USER, dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('a missing item id → NotFoundException', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([buildItem('item-001')]); // only 1 of 2 found

    await expect(service.bulkReprice(ADMIN_USER, dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  // ── Full atomicity — a mid-batch concurrent change rolls back the whole transaction ──
  it('a concurrent void discovered on the in-txn re-read of item 2 aborts the WHOLE batch (item 1 is not left half-applied)', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([
      buildItem('item-001'),
      buildItem('item-002'),
    ]);
    // Passes the pre-check (not voided there) but the row-locked re-read inside
    // the transaction finds it was voided by a concurrent request in between.
    const tx = wireTx({ 'item-002': { status: DeliveryStatus.VOIDED, voidedAt: new Date() } });

    await expect(service.bulkReprice(ADMIN_USER, dto)).rejects.toBeInstanceOf(ConflictException);

    // Item 1 WAS processed before the throw (loop order), but since the whole
    // callback rejects, Prisma's $transaction never commits any of it — the
    // real atomicity guarantee here is that everything ran inside one
    // prisma.$transaction(...) call, asserted below.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.dailySheetItem.update).toHaveBeenCalledTimes(1); // item 1 only, before the throw
    // No audit row or cache invalidation for a batch that never committed.
    expect(mockAudit.log).not.toHaveBeenCalled();
    expect(mockCache.invalidateOverview).not.toHaveBeenCalled();
  });

  it('ledger negative-wallet BadRequest → UnprocessableEntity BULK_REPRICE_WALLET_NEGATIVE (defensive — never actually reachable for a pure reprice since quantities never change)', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([
      buildItem('item-001'),
      buildItem('item-002'),
    ]);
    wireTx();
    mockLedger.recordDelivery.mockRejectedValue(
      new BadRequestException('Editing this delivery would make the bottle wallet negative (current: 2, delta: -5).'),
    );

    await expect(service.bulkReprice(ADMIN_USER, dto)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.bulkReprice(ADMIN_USER, dto)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BULK_REPRICE_WALLET_NEGATIVE' }),
    });
    expect(mockAudit.log).not.toHaveBeenCalled();
  });

  it('a non-negative BadRequest from the ledger is NOT swallowed as 422', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([
      buildItem('item-001'),
      buildItem('item-002'),
    ]);
    wireTx();
    mockLedger.recordDelivery.mockRejectedValue(new BadRequestException('some other ledger failure'));

    await expect(service.bulkReprice(ADMIN_USER, dto)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.bulkReprice(ADMIN_USER, dto)).rejects.not.toBeInstanceOf(UnprocessableEntityException);
  });
});
