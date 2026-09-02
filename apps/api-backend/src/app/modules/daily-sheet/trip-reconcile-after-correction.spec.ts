import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { DeliveryStatus } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { DailySheetService } from './daily-sheet.service';
import { LedgerService } from '../transaction/ledger.service';
import { AuditService } from '../audit/audit.service';
import { FcmService } from '../fcm/fcm.service';
import { DeliveryIssueService } from '../delivery-issue/delivery-issue.service';
import { NotificationService } from '../notifications/notification.service';
import { InAppNotificationService } from '../notifications/in-app-notification.service';
import { NotificationSettingsService } from '../notifications/notification-settings.service';
import { CollectionPolicyService } from '../collection-policy/collection-policy.service';
import { CrewCashDistributionService } from '../payroll/crew-cash-distribution.service';
import { VehicleCheckService } from '../fleet/vehicle-check.service';
import { SheetDiscrepancyCaseService } from '../sheet-discrepancy-case/sheet-discrepancy-case.service';
import { StorageService } from '../../common/storage/storage.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { DeliveryReceiptPdfService } from '../whatsapp/delivery-receipt-pdf.service';

/**
 * Unit tests: automatic trip-summary reconciliation after a closed-sheet
 * delivery correction / void.
 *
 * When a closed-sheet delivery's bottle figures change, buildReconciliation's
 * bottleDiscrepancy (which reads item.filledDropped / filledReceived live) goes
 * non-zero purely because of the edit. correctClosedDelivery() and
 * voidDelivery() now shift the affected trip's returnedFilled / collectedEmpty
 * by the offsetting delta via the existing applyTripCheckinDeltas() path:
 *
 *   returnedFilled += deltaFilledReceived - deltaDrop
 *   collectedEmpty += deltaEmpty
 *
 * and write a CLOSED_TRIP_CHECKIN_CORRECTED audit row. Only fires when the
 * sheet is closed, the item is attributed to a trip, and that trip's product
 * matches the item's.
 */
describe('DailySheetService — auto trip reconciliation after closed-sheet delivery change', () => {
  let service: DailySheetService;
  let mockPrisma: any;
  let mockLedger: any;
  let mockAudit: any;
  let mockCache: any;
  let mockWarehouse: any;

  const VENDOR_ID = 'vendor-001';
  const ITEM_ID = 'item-001';
  const CUSTOMER_ID = 'customer-001';
  const PRODUCT_ID = 'product-001';
  const SHEET_ID = 'sheet-001';
  const LOAD_ID = 'load-001';
  const SHEET_DATE = new Date('2026-08-17T00:00:00.000Z');

  const ADMIN_USER: AuthUser = {
    userId: 'admin-1',
    email: 'a@example.com',
    name: 'Admin',
    role: 'VENDOR_ADMIN' as AuthUser['role'],
    vendorId: VENDOR_ID,
    customerId: null,
  };

  function buildItem(overrides: Record<string, unknown> = {}) {
    return {
      id: ITEM_ID,
      status: DeliveryStatus.COMPLETED,
      voidedAt: null,
      isCorrection: false,
      customerId: CUSTOMER_ID,
      productId: PRODUCT_ID,
      dailySheetId: SHEET_ID,
      dailySheetLoadId: LOAD_ID,
      filledDropped: 3,
      emptyReceived: 2,
      filledReceived: 0,
      cashCollected: 300,
      pricePerBottle: 100,
      dailySheet: { vendorId: VENDOR_ID, isClosed: true, date: SHEET_DATE },
      customer: { id: CUSTOMER_ID, isBillingExempt: false },
      product: { id: PRODUCT_ID },
      ...overrides,
    };
  }

  function buildLoad(overrides: Record<string, unknown> = {}) {
    return {
      id: LOAD_ID,
      returnedFilled: 10,
      collectedEmpty: 8,
      damagedOnVan: 0,
      leakedOnVan: 0,
      productId: PRODUCT_ID,
      ...overrides,
    };
  }

  /** Wires prisma.$transaction to run its callback against a mock tx client. */
  function wireTx(load: any = buildLoad(), opts: { ledgerTxnCount?: number } = {}) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      dailySheetItem: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ status: DeliveryStatus.COMPLETED, voidedAt: null }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: ITEM_ID, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bottleWallet: { findUnique: jest.fn().mockResolvedValue({ balance: 5 }) },
      customer: { findUnique: jest.fn().mockResolvedValue({ financialBalance: 100 }) },
      transaction: {
        count: jest.fn().mockResolvedValue(opts.ledgerTxnCount ?? 0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      dailySheetLoad: {
        findUnique: jest.fn().mockResolvedValue(load),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: LOAD_ID, ...data })),
      },
      dailySheet: { update: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
    return tx;
  }

  /** The last CLOSED_TRIP_CHECKIN_CORRECTED audit payload, or undefined. */
  function tripAudit() {
    const call = mockAudit.log.mock.calls.find(
      (c: any[]) => c[0]?.action === 'CLOSED_TRIP_CHECKIN_CORRECTED',
    );
    return call?.[0];
  }

  beforeEach(async () => {
    mockLedger = { recordDelivery: jest.fn().mockResolvedValue({ success: true }) };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockCache = {
      invalidateDailyDashboard: jest.fn().mockResolvedValue(undefined),
      invalidateOverview: jest.fn().mockResolvedValue(undefined),
      invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
    };
    mockWarehouse = { recordCheckinCorrection: jest.fn().mockResolvedValue(undefined) };
    mockPrisma = {
      dailySheetItem: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailySheetService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: mockLedger },
        { provide: AuditService, useValue: mockAudit },
        { provide: FcmService, useValue: {} },
        { provide: DeliveryIssueService, useValue: {} },
        { provide: CacheInvalidationService, useValue: mockCache },
        { provide: NotificationService, useValue: {} },
        { provide: InAppNotificationService, useValue: {} },
        { provide: NotificationSettingsService, useValue: {} },
        { provide: CollectionPolicyService, useValue: {} },
        { provide: CrewCashDistributionService, useValue: {} },
        { provide: VehicleCheckService, useValue: {} },
        { provide: SheetDiscrepancyCaseService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: WarehouseService, useValue: mockWarehouse },
        { provide: DeliveryReceiptPdfService, useValue: {} },
        { provide: getQueueToken(QUEUE_NAMES.DAILY_SHEET_GENERATION), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<DailySheetService>(DailySheetService);
    (service as any).prisma = mockPrisma;
    (service as any).ledger = mockLedger;
    (service as any).audit = mockAudit;
    (service as any).cache = mockCache;
    (service as any).warehouse = mockWarehouse;
  });

  afterEach(() => jest.clearAllMocks());

  const correctionDto = (over: Record<string, unknown> = {}) =>
    ({
      filledDropped: 2,
      emptyReceived: 2,
      filledReceived: 0,
      cashCollected: 200,
      correctionNote: 'driver miscounted the drop',
      ...over,
    } as any);

  // ── 1. correction reducing the drop ──────────────────────────────────────
  it('correction reducing filledDropped 3 → 2 raises the trip returnedFilled by 1', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem({ filledDropped: 3 }));
    const tx = wireTx(buildLoad({ returnedFilled: 10, collectedEmpty: 8 }));

    await service.correctClosedDelivery(ADMIN_USER, ITEM_ID, correctionDto({ filledDropped: 2 }));

    // returnedFilled 10 → 11, collectedEmpty untouched.
    expect(tx.dailySheetLoad.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LOAD_ID },
        data: expect.objectContaining({
          returnedFilled: 11,
          collectedEmpty: 8,
          editCount: { increment: 1 },
        }),
      }),
    );
    // Sheet aggregate moves by the delta only.
    expect(tx.dailySheet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SHEET_ID },
        data: { filledInCount: { increment: 1 }, emptyInCount: { increment: 0 } },
      }),
    );
    // Signed warehouse correction row.
    expect(mockWarehouse.recordCheckinCorrection).toHaveBeenCalledWith(
      VENDOR_ID,
      PRODUCT_ID,
      { filledDelta: 1, emptyDelta: 0, damagedDelta: 0, leakedDelta: 0 },
      SHEET_ID,
      tx,
    );
    // Audit reuses the closed-trip-correction action.
    expect(tripAudit()).toMatchObject({
      action: 'CLOSED_TRIP_CHECKIN_CORRECTED',
      entity: 'DailySheetLoad',
      entityId: LOAD_ID,
      changes: {
        before: { returnedFilled: 10, collectedEmpty: 8 },
        after: expect.objectContaining({ returnedFilled: 11, collectedEmpty: 8 }),
      },
    });
    expect(tripAudit().changes.after.correctionNote).toMatch(/Auto-reconciled/i);
  });

  // ── 2. correction increasing the drop ───────────────────────────────────
  it('correction increasing filledDropped 2 → 5 lowers the trip returnedFilled by 3', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem({ filledDropped: 2 }));
    const tx = wireTx(buildLoad({ returnedFilled: 10, collectedEmpty: 8 }));

    await service.correctClosedDelivery(ADMIN_USER, ITEM_ID, correctionDto({ filledDropped: 5 }));

    expect(tx.dailySheetLoad.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ returnedFilled: 7, collectedEmpty: 8 }),
      }),
    );
    expect(mockWarehouse.recordCheckinCorrection).toHaveBeenCalledWith(
      VENDOR_ID,
      PRODUCT_ID,
      { filledDelta: -3, emptyDelta: 0, damagedDelta: 0, leakedDelta: 0 },
      SHEET_ID,
      tx,
    );
    expect(tripAudit().changes.after).toEqual(
      expect.objectContaining({ returnedFilled: 7, collectedEmpty: 8 }),
    );
  });

  // ── 3. void delivery ────────────────────────────────────────────────────
  it('voiding a delivery (drop 4, empty 1) raises returnedFilled by 4 and lowers collectedEmpty by 1', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildItem({ filledDropped: 4, emptyReceived: 1, filledReceived: 0 }),
    );
    const tx = wireTx(buildLoad({ returnedFilled: 10, collectedEmpty: 8 }));

    await service.voidDelivery(ADMIN_USER, ITEM_ID, { voidReason: 'DATA_ENTRY_ERROR' } as any);

    expect(tx.dailySheetLoad.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ returnedFilled: 14, collectedEmpty: 7 }),
      }),
    );
    expect(tx.dailySheet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { filledInCount: { increment: 4 }, emptyInCount: { increment: -1 } },
      }),
    );
    expect(mockWarehouse.recordCheckinCorrection).toHaveBeenCalledWith(
      VENDOR_ID,
      PRODUCT_ID,
      { filledDelta: 4, emptyDelta: -1, damagedDelta: 0, leakedDelta: 0 },
      SHEET_ID,
      tx,
    );
    expect(tripAudit()).toMatchObject({
      action: 'CLOSED_TRIP_CHECKIN_CORRECTED',
      entityId: LOAD_ID,
      changes: {
        before: { returnedFilled: 10, collectedEmpty: 8 },
        after: expect.objectContaining({ returnedFilled: 14, collectedEmpty: 7 }),
      },
    });
    expect(tripAudit().changes.after.correctionNote).toMatch(/void/i);
  });

  // ── 4. empty-bottle-only change ─────────────────────────────────────────
  it('correction changing only emptyReceived 2 → 5 raises collectedEmpty by 3, returnedFilled untouched', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildItem({ filledDropped: 3, emptyReceived: 2 }),
    );
    const tx = wireTx(buildLoad({ returnedFilled: 10, collectedEmpty: 8 }));

    await service.correctClosedDelivery(
      ADMIN_USER,
      ITEM_ID,
      correctionDto({ filledDropped: 3, emptyReceived: 5 }),
    );

    expect(tx.dailySheetLoad.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ returnedFilled: 10, collectedEmpty: 11 }),
      }),
    );
    expect(tx.dailySheet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { filledInCount: { increment: 0 }, emptyInCount: { increment: 3 } },
      }),
    );
    expect(mockWarehouse.recordCheckinCorrection).toHaveBeenCalledWith(
      VENDOR_ID,
      PRODUCT_ID,
      { filledDelta: 0, emptyDelta: 3, damagedDelta: 0, leakedDelta: 0 },
      SHEET_ID,
      tx,
    );
  });

  // ── Guard: no trip touch when the trip's product differs from the item's ─
  it('does NOT reconcile a trip whose productId differs from the item', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem({ filledDropped: 3 }));
    const tx = wireTx(buildLoad({ productId: 'other-product' }));

    await service.correctClosedDelivery(ADMIN_USER, ITEM_ID, correctionDto({ filledDropped: 2 }));

    expect(tx.dailySheetLoad.update).not.toHaveBeenCalled();
    expect(tx.dailySheet.update).not.toHaveBeenCalled();
    expect(mockWarehouse.recordCheckinCorrection).not.toHaveBeenCalled();
    expect(tripAudit()).toBeUndefined();
  });
});
