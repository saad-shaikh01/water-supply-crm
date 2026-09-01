import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
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
 * Unit tests: DailySheetService.correctClosedTrip — Post-Close Trip Correction.
 *
 * Dedicated endpoint (PATCH /daily-sheets/:id/loads/:loadId/correct-checkin)
 * that amends a checked-in load trip's four physical counts AFTER the sheet is
 * closed, without reopening it. Applies the same signed deltas through the
 * warehouse ledger + sheet aggregates as a normal trip edit (shared
 * applyTripCheckinDeltas helper) but re-reads the load INSIDE the txn for
 * concurrency safety, maps a warehouse "insufficient" BadRequest to a friendly
 * 422, writes a CLOSED_TRIP_CHECKIN_CORRECTED audit row, and fans out the
 * 3-way cache invalidation. It deliberately does NOT re-run buildReconciliation
 * / createCasesForSheet and does NOT touch the frozen close-time cashExpected.
 */
describe('DailySheetService.correctClosedTrip', () => {
  let service: DailySheetService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockCache: any;
  let mockWarehouse: any;
  let mockDiscrepancyCases: any;

  const VENDOR_ID = 'vendor-001';
  const OTHER_VENDOR = 'vendor-999';
  const SHEET_ID = 'sheet-001';
  const LOAD_ID = 'load-001';
  const PRODUCT_ID = 'product-001';
  const SHEET_DATE = new Date('2026-08-22T00:00:00.000Z');
  const TRIP_STARTED = new Date('2026-08-22T06:00:00.000Z');
  const TRIP_ENDED = new Date('2026-08-22T10:00:00.000Z');

  const ADMIN_USER: AuthUser = {
    userId: 'admin-1',
    email: 'a@example.com',
    name: 'Admin',
    role: 'VENDOR_ADMIN' as AuthUser['role'],
    vendorId: VENDOR_ID,
    customerId: null,
  };

  const dto = {
    returnedFilled: 20,
    collectedEmpty: 8,
    damagedOnVan: 1,
    leakedOnVan: 2,
    correctionNote: 'fixed count',
  } as any;

  function buildSheet(overrides: Record<string, unknown> = {}) {
    return { id: SHEET_ID, vendorId: VENDOR_ID, isClosed: true, date: SHEET_DATE, ...overrides };
  }

  // Outer (pre-txn) load read — drives the audit `before` block and the
  // maxReturnedFilled cap.
  function buildLoad(overrides: Record<string, unknown> = {}) {
    return {
      id: LOAD_ID,
      dailySheetId: SHEET_ID,
      tripNumber: 1,
      startedAt: TRIP_STARTED,
      endedAt: TRIP_ENDED,
      loadedFilled: 100,
      returnedFilled: 10,
      collectedEmpty: 5,
      damagedOnVan: 0,
      leakedOnVan: 0,
      productId: PRODUCT_ID,
      editCount: 0,
      lastEditedAt: null,
      ...overrides,
    };
  }

  // In-txn re-read (findUnique with a narrow select). Deltas are computed from
  // THIS snapshot, not the outer read.
  function freshLoad(overrides: Record<string, unknown> = {}) {
    return {
      id: LOAD_ID,
      returnedFilled: 10,
      collectedEmpty: 5,
      damagedOnVan: 0,
      leakedOnVan: 0,
      loadedFilled: 100,
      productId: PRODUCT_ID,
      endedAt: TRIP_ENDED,
      ...overrides,
    };
  }

  function wireTx(fresh: Record<string, unknown> = freshLoad()) {
    const tx = {
      // Row lock taken as the FIRST statement inside the txn —
      // `SELECT … FOR UPDATE` serialises concurrent corrections of the same load.
      $queryRaw: jest.fn().mockResolvedValue([]),
      dailySheetLoad: {
        findUnique: jest.fn().mockResolvedValue(fresh),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) => Promise.resolve({ id: LOAD_ID, ...data })),
      },
      dailySheet: { update: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
    return tx;
  }

  beforeEach(async () => {
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockCache = {
      invalidateDailyDashboard: jest.fn().mockResolvedValue(undefined),
      invalidateOverview: jest.fn().mockResolvedValue(undefined),
      invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
    };
    mockWarehouse = { recordCheckinCorrection: jest.fn().mockResolvedValue(undefined) };
    mockDiscrepancyCases = { createCasesForSheet: jest.fn().mockResolvedValue([]) };
    mockPrisma = {
      dailySheet: { findFirst: jest.fn(), update: jest.fn() },
      dailySheetLoad: { findFirst: jest.fn() },
      dailySheetItem: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { filledReceived: 0 } }),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailySheetService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: {} },
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
        { provide: SheetDiscrepancyCaseService, useValue: mockDiscrepancyCases },
        { provide: StorageService, useValue: {} },
        { provide: WarehouseService, useValue: mockWarehouse },
        { provide: DeliveryReceiptPdfService, useValue: {} },
        { provide: getQueueToken(QUEUE_NAMES.DAILY_SHEET_GENERATION), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<DailySheetService>(DailySheetService);
    (service as any).prisma = mockPrisma;
    (service as any).audit = mockAudit;
    (service as any).cache = mockCache;
    (service as any).warehouse = mockWarehouse;
    (service as any).discrepancyCases = mockDiscrepancyCases;
  });

  afterEach(() => jest.clearAllMocks());

  // ── Happy path ────────────────────────────────────────────────────────────
  it('applies the in-txn deltas, audits, and fans out the 3-way cache invalidation', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet());
    mockPrisma.dailySheetLoad.findFirst.mockResolvedValue(buildLoad());
    const tx = wireTx();

    await service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, dto);

    // Single $transaction, and the in-txn re-read happened.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.dailySheetLoad.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: LOAD_ID } }),
    );

    // Row lock: SELECT … FOR UPDATE taken exactly once, BEFORE the re-read,
    // with loadId bound as a tagged-template parameter (not interpolated).
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [rawStrings, ...rawValues] = tx.$queryRaw.mock.calls[0];
    expect((rawStrings as string[]).join('?')).toMatch(/FOR UPDATE/i);
    expect((rawStrings as string[]).join('?')).toMatch(/"DailySheetLoad"/);
    expect(rawValues).toEqual([LOAD_ID]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.dailySheetLoad.findUnique.mock.invocationCallOrder[0],
    );

    // Load row: 4 absolute values + editCount increment + lastEditedAt stamp.
    expect(tx.dailySheetLoad.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LOAD_ID },
        data: expect.objectContaining({
          returnedFilled: 20,
          collectedEmpty: 8,
          damagedOnVan: 1,
          leakedOnVan: 2,
          editCount: { increment: 1 },
        }),
      }),
    );
    expect(tx.dailySheetLoad.update.mock.calls[0][0].data.lastEditedAt).toBeInstanceOf(Date);

    // Sheet aggregates move by the DELTA vs the in-txn re-read (10→20, 5→8).
    expect(tx.dailySheet.update).toHaveBeenCalledWith({
      where: { id: SHEET_ID },
      data: { filledInCount: { increment: 10 }, emptyInCount: { increment: 3 } },
    });

    // Warehouse ledger: signed deltas + productId, passed the tx client.
    expect(mockWarehouse.recordCheckinCorrection).toHaveBeenCalledWith(
      VENDOR_ID,
      PRODUCT_ID,
      { filledDelta: 10, emptyDelta: 3, damagedDelta: 1, leakedDelta: 2 },
      SHEET_ID,
      tx,
    );

    // Audit: before = pre-txn 4 counts, after = dto 4 counts + correctionNote.
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: VENDOR_ID,
        userId: ADMIN_USER.userId,
        action: 'CLOSED_TRIP_CHECKIN_CORRECTED',
        entity: 'DailySheetLoad',
        entityId: LOAD_ID,
        changes: {
          before: { returnedFilled: 10, collectedEmpty: 5, damagedOnVan: 0, leakedOnVan: 0 },
          after: {
            returnedFilled: 20,
            collectedEmpty: 8,
            damagedOnVan: 1,
            leakedOnVan: 2,
            correctionNote: 'fixed count',
          },
        },
      }),
    );

    // 3-way cache invalidation.
    expect(mockCache.invalidateDailyDashboard).toHaveBeenCalledWith(VENDOR_ID, '2026-08-22');
    expect(mockCache.invalidateOverview).toHaveBeenCalledWith(VENDOR_ID);
    expect(mockCache.invalidateAnalytics).toHaveBeenCalledWith(VENDOR_ID);
  });

  // ── productId === null ────────────────────────────────────────────────────
  it('load with productId null → warehouse ledger skipped, everything else still runs', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet());
    mockPrisma.dailySheetLoad.findFirst.mockResolvedValue(buildLoad({ productId: null }));
    const tx = wireTx(freshLoad({ productId: null }));

    await service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, dto);

    expect(mockWarehouse.recordCheckinCorrection).not.toHaveBeenCalled();
    expect(tx.dailySheetLoad.update).toHaveBeenCalledTimes(1);
    expect(tx.dailySheet.update).toHaveBeenCalledTimes(1);
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CLOSED_TRIP_CHECKIN_CORRECTED' }),
    );
    expect(mockCache.invalidateAnalytics).toHaveBeenCalledWith(VENDOR_ID);
  });

  // ── In-txn re-read drives the delta (concurrency intent) ──────────────────
  it('computes the delta from the in-txn re-read, not the pre-txn snapshot', async () => {
    // Outer read says returnedFilled 10; by the time the txn re-reads, a
    // concurrent correction has moved it to 12. dto asks for 20 → delta +8.
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet());
    mockPrisma.dailySheetLoad.findFirst.mockResolvedValue(buildLoad({ returnedFilled: 10 }));
    const tx = wireTx(freshLoad({ returnedFilled: 12 }));

    await service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, dto);

    expect(tx.dailySheet.update).toHaveBeenCalledWith({
      where: { id: SHEET_ID },
      data: { filledInCount: { increment: 8 }, emptyInCount: { increment: 3 } },
    });
    expect(mockWarehouse.recordCheckinCorrection).toHaveBeenCalledWith(
      VENDOR_ID,
      PRODUCT_ID,
      expect.objectContaining({ filledDelta: 8 }),
      SHEET_ID,
      tx,
    );
    // Audit `before` still reflects the pre-txn snapshot the operator saw (10).
    expect(mockAudit.log.mock.calls[0][0].changes.before.returnedFilled).toBe(10);
  });

  // ── No reconciliation side effects ───────────────────────────────────────
  it('does NOT re-run reconciliation / discrepancy cases / cashExpected', async () => {
    const reconSpy = jest.spyOn(service as any, 'buildReconciliation');
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet());
    mockPrisma.dailySheetLoad.findFirst.mockResolvedValue(buildLoad());
    const tx = wireTx();

    await service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, dto);

    expect(reconSpy).not.toHaveBeenCalled();
    expect(mockDiscrepancyCases.createCasesForSheet).not.toHaveBeenCalled();
    // No outer (non-txn) dailySheet.update at all.
    expect(mockPrisma.dailySheet.update).not.toHaveBeenCalled();
    // The one in-txn dailySheet.update carries no cashExpected / cashCollected key.
    for (const call of tx.dailySheet.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('cashExpected');
      expect(call[0].data).not.toHaveProperty('cashCollected');
    }
  });

  // ── Rejections ──────────────────────────────────────────────────────────
  it('sheet not closed → ConflictException, nothing mutated', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet({ isClosed: false }));

    await expect(
      service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, dto),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockAudit.log).not.toHaveBeenCalled();
    expect(mockCache.invalidateDailyDashboard).not.toHaveBeenCalled();
  });

  it('sheet not found → NotFoundException', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(null);

    await expect(
      service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, dto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('wrong tenant (vendor-scoped findFirst returns null) → NotFoundException', async () => {
    // findFirst({ where: { id, vendorId } }) yields null for another vendor's sheet.
    mockPrisma.dailySheet.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.vendorId === VENDOR_ID ? null : buildSheet({ vendorId: OTHER_VENDOR })),
    );

    await expect(
      service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, dto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('load not found → NotFoundException', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet());
    mockPrisma.dailySheetLoad.findFirst.mockResolvedValue(null);

    await expect(
      service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, dto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('trip has not ended (load.endedAt null) → ConflictException', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet());
    mockPrisma.dailySheetLoad.findFirst.mockResolvedValue(buildLoad({ endedAt: null }));

    await expect(
      service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, dto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('returnedFilled above loadedFilled + Σ filledReceived → BadRequestException', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet());
    mockPrisma.dailySheetLoad.findFirst.mockResolvedValue(buildLoad({ loadedFilled: 100 }));
    mockPrisma.dailySheetItem.aggregate.mockResolvedValue({ _sum: { filledReceived: 5 } });

    await expect(
      service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, { ...dto, returnedFilled: 106 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('returnedFilled exactly at the cap (loadedFilled + Σ filledReceived) is allowed', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet());
    mockPrisma.dailySheetLoad.findFirst.mockResolvedValue(buildLoad({ loadedFilled: 100 }));
    mockPrisma.dailySheetItem.aggregate.mockResolvedValue({ _sum: { filledReceived: 5 } });
    wireTx(freshLoad());

    await expect(
      service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, { ...dto, returnedFilled: 105 }),
    ).resolves.toBeDefined();
  });

  // ── Warehouse insufficient-stock → friendly 422 ─────────────────────────
  it('warehouse "Insufficient filled stock" → UnprocessableEntity CLOSED_TRIP_CORRECTION_INSUFFICIENT_STOCK', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet());
    mockPrisma.dailySheetLoad.findFirst.mockResolvedValue(buildLoad());
    wireTx();
    mockWarehouse.recordCheckinCorrection.mockRejectedValue(
      new BadRequestException('Insufficient filled stock in warehouse (have 3, need 8).'),
    );

    await expect(
      service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, dto),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    mockWarehouse.recordCheckinCorrection.mockRejectedValue(
      new BadRequestException('Insufficient filled stock in warehouse (have 3, need 8).'),
    );
    await expect(
      service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, dto),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CLOSED_TRIP_CORRECTION_INSUFFICIENT_STOCK' }),
    });

    // Audit / cache never run when the txn throws.
    expect(mockAudit.log).not.toHaveBeenCalled();
    expect(mockCache.invalidateDailyDashboard).not.toHaveBeenCalled();
  });

  it('a warehouse BadRequest WITHOUT "insufficient" rethrows unchanged (not mapped to 422)', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet());
    mockPrisma.dailySheetLoad.findFirst.mockResolvedValue(buildLoad());
    wireTx();
    mockWarehouse.recordCheckinCorrection.mockRejectedValue(
      new BadRequestException('some other warehouse failure'),
    );

    await expect(
      service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, dto),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.correctClosedTrip(ADMIN_USER, SHEET_ID, LOAD_ID, dto),
    ).rejects.not.toBeInstanceOf(UnprocessableEntityException);
  });
});
