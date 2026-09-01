import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConflictException } from '@nestjs/common';
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
 * Unit tests: the boundary between checkinLoad() and the dedicated Post-Close
 * Trip Correction endpoint.
 *
 *  - checkinLoad() still hard-blocks on a CLOSED sheet — the extraction of
 *    applyTripCheckinDeltas + the new correctClosedTrip endpoint did NOT relax
 *    that guard.
 *  - applyTripCheckinDeltas parity: checkinLoad()'s trip-EDIT branch and
 *    correctClosedTrip both route through the same helper, so a
 *    forceResubmit edit moves the sheet aggregates + warehouse ledger by the
 *    signed DELTA and stamps editCount / lastEditedAt.
 *  - checkinLoad()'s FIRST-TIME branch is unchanged: 4 separate recordCheckin*
 *    calls + endedAt stamped, no correction ledger entry.
 */
describe('DailySheetService — Post-Close Trip Correction guards / checkinLoad parity', () => {
  let service: DailySheetService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockCache: any;
  let mockWarehouse: any;

  const VENDOR_ID = 'vendor-001';
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
      editUnlockExpiresAt: null,
      editCount: 0,
      lastEditedAt: null,
      ...overrides,
    };
  }

  function wireTx() {
    const tx = {
      dailySheetLoad: {
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
    mockCache = { invalidateDailyDashboard: jest.fn().mockResolvedValue(undefined) };
    mockWarehouse = {
      recordCheckinFilled: jest.fn().mockResolvedValue(undefined),
      recordCheckinEmpty: jest.fn().mockResolvedValue(undefined),
      recordCheckinDamaged: jest.fn().mockResolvedValue(undefined),
      recordCheckinLeaked: jest.fn().mockResolvedValue(undefined),
      recordCheckinCorrection: jest.fn().mockResolvedValue(undefined),
    };
    mockPrisma = {
      dailySheet: { findFirst: jest.fn() },
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
        { provide: SheetDiscrepancyCaseService, useValue: {} },
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
  });

  afterEach(() => jest.clearAllMocks());

  // ── checkinLoad still closed-sheet-blocked ────────────────────────────────
  it('checkinLoad() throws ConflictException on a CLOSED sheet (guard NOT relaxed)', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue({
      id: SHEET_ID,
      vendorId: VENDOR_ID,
      isClosed: true,
      date: SHEET_DATE,
    });

    await expect(
      service.checkinLoad(ADMIN_USER, SHEET_ID, LOAD_ID, {
        returnedFilled: 1,
        collectedEmpty: 1,
        damagedOnVan: 0,
        leakedOnVan: 0,
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  // ── checkinLoad edit branch → shared helper, delta semantics ─────────────
  it('checkinLoad() edit branch (forceResubmit) moves aggregates + ledger by the DELTA and stamps editCount', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue({
      id: SHEET_ID,
      vendorId: VENDOR_ID,
      isClosed: false,
      date: SHEET_DATE,
    });
    mockPrisma.dailySheetLoad.findFirst.mockResolvedValue(buildLoad());
    const tx = wireTx();

    await service.checkinLoad(ADMIN_USER, SHEET_ID, LOAD_ID, {
      returnedFilled: 20,
      collectedEmpty: 8,
      damagedOnVan: 1,
      leakedOnVan: 2,
      forceResubmit: true,
    } as any);

    // Load row: absolute values + editCount increment + lastEditedAt stamp,
    // and NO endedAt reset.
    const updateArg = tx.dailySheetLoad.update.mock.calls[0][0];
    expect(updateArg.data).toEqual(
      expect.objectContaining({
        returnedFilled: 20,
        collectedEmpty: 8,
        damagedOnVan: 1,
        leakedOnVan: 2,
        editCount: { increment: 1 },
      }),
    );
    expect(updateArg.data.lastEditedAt).toBeInstanceOf(Date);
    expect(updateArg.data).not.toHaveProperty('endedAt');

    // Sheet aggregates by the delta (10→20, 5→8).
    expect(tx.dailySheet.update).toHaveBeenCalledWith({
      where: { id: SHEET_ID },
      data: { filledInCount: { increment: 10 }, emptyInCount: { increment: 3 } },
    });

    // Correction ledger entry by the delta; the 4 first-time recordCheckin*
    // helpers are NOT used on an edit.
    expect(mockWarehouse.recordCheckinCorrection).toHaveBeenCalledWith(
      VENDOR_ID,
      PRODUCT_ID,
      { filledDelta: 10, emptyDelta: 3, damagedDelta: 1, leakedDelta: 2 },
      SHEET_ID,
      tx,
    );
    expect(mockWarehouse.recordCheckinFilled).not.toHaveBeenCalled();
  });

  // ── checkinLoad first-time branch unchanged ─────────────────────────────
  it('checkinLoad() first-time check-in stamps endedAt and calls the 4 separate recordCheckin* helpers', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue({
      id: SHEET_ID,
      vendorId: VENDOR_ID,
      isClosed: false,
      date: SHEET_DATE,
    });
    mockPrisma.dailySheetLoad.findFirst.mockResolvedValue(
      buildLoad({ endedAt: null, returnedFilled: 0, collectedEmpty: 0 }),
    );
    const tx = wireTx();

    await service.checkinLoad(ADMIN_USER, SHEET_ID, LOAD_ID, {
      returnedFilled: 20,
      collectedEmpty: 8,
      damagedOnVan: 1,
      leakedOnVan: 2,
    } as any);

    const updateArg = tx.dailySheetLoad.update.mock.calls[0][0];
    expect(updateArg.data.endedAt).toBeInstanceOf(Date);
    expect(updateArg.data).not.toHaveProperty('editCount');

    // Full new values applied to the sheet aggregates (nothing to net against).
    expect(tx.dailySheet.update).toHaveBeenCalledWith({
      where: { id: SHEET_ID },
      data: { filledInCount: { increment: 20 }, emptyInCount: { increment: 8 } },
    });

    expect(mockWarehouse.recordCheckinFilled).toHaveBeenCalledWith(VENDOR_ID, PRODUCT_ID, 20, SHEET_ID, tx);
    expect(mockWarehouse.recordCheckinEmpty).toHaveBeenCalledWith(VENDOR_ID, PRODUCT_ID, 8, SHEET_ID, tx);
    expect(mockWarehouse.recordCheckinDamaged).toHaveBeenCalledWith(VENDOR_ID, PRODUCT_ID, 1, SHEET_ID, tx);
    expect(mockWarehouse.recordCheckinLeaked).toHaveBeenCalledWith(VENDOR_ID, PRODUCT_ID, 2, SHEET_ID, tx);
    expect(mockWarehouse.recordCheckinCorrection).not.toHaveBeenCalled();
  });
});
