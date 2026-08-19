import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { DailySheetService } from './daily-sheet.service';
import { LedgerService } from '../transaction/ledger.service';
import { AuditService } from '../audit/audit.service';
import { FcmService } from '../fcm/fcm.service';
import { DeliveryIssueService } from '../delivery-issue/delivery-issue.service';
import { CacheInvalidationService } from '@water-supply-crm/caching';
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
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { UserRole } from '@prisma/client';

/**
 * Unit tests: `DailySheetService.closeSheet()`'s composition with
 * `SheetDiscrepancyCaseService.createCasesForSheet` — sibling to
 * `daily-sheet-close-crew-cash-sync.spec.ts`, same structure/assertions.
 * Verifies the isClosed flip, the Crew Cash sync, and discrepancy-case
 * creation all share one transaction (so a partial failure anywhere rolls
 * the whole close back), and that the summary flows into the return value.
 */
describe('DailySheetService.closeSheet — Discrepancy Case creation', () => {
  let service: DailySheetService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockCache: any;
  let mockCrewCash: any;
  let mockDiscrepancyCases: any;
  let tx: any;

  const VENDOR_ID = 'vendor-001';
  const SHEET_ID = 'sheet-001';
  const DRIVER_ID = 'driver-001';
  const ACTOR_ID = 'admin-001';
  const ACTOR_ROLE = UserRole.VENDOR_ADMIN;
  const SHEET_DATE = new Date('2026-08-06T00:00:00.000Z');
  // Trip feature: cash is no longer accumulated per-trip check-in — closeSheet
  // now takes the driver's single actual cash hand-in figure as a param.
  const ACTUAL_CASH_HANDED_IN = 500;

  function buildOpenSheet(overrides: Record<string, unknown> = {}) {
    return {
      id: SHEET_ID,
      vendorId: VENDOR_ID,
      driverId: DRIVER_ID,
      date: SHEET_DATE,
      isClosed: false,
      filledOutCount: 0,
      filledInCount: 0,
      emptyInCount: 0,
      cashCollected: 0,
      items: [],
      expenses: [],
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockCache = {
      invalidateDailyDashboard: jest.fn().mockResolvedValue(undefined),
      invalidateOverview: jest.fn().mockResolvedValue(undefined),
      invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
    };
    mockCrewCash = { syncSheetToLedger: jest.fn().mockResolvedValue({ synced: 0, skippedPendingApproval: 0 }) };
    mockDiscrepancyCases = { createCasesForSheet: jest.fn().mockResolvedValue({ createdCount: 0, types: [] }) };

    tx = {
      dailySheet: {
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: SHEET_ID, ...data })),
      },
    };

    mockPrisma = {
      dailySheet: { findFirst: jest.fn().mockResolvedValue(buildOpenSheet()) },
      dailySheetLoad: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
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
        { provide: CrewCashDistributionService, useValue: mockCrewCash },
        { provide: StorageService, useValue: {} },
        { provide: WarehouseService, useValue: {} },
        { provide: DeliveryReceiptPdfService, useValue: {} },
        {
          provide: VehicleCheckService,
          useValue: {
            assertTripStartClear: jest.fn().mockResolvedValue(undefined),
            // Soft Close (Amendment R9): closeSheet's assertSheetCloseable now
            // also requires an END check before closing, same tier as the
            // START check gate on trip start.
            assertTripEndClear: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: SheetDiscrepancyCaseService, useValue: mockDiscrepancyCases },
        { provide: getQueueToken(QUEUE_NAMES.DAILY_SHEET_GENERATION), useValue: { add: jest.fn(), getRepeatableJobs: jest.fn().mockResolvedValue([]), upsertJobScheduler: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get<DailySheetService>(DailySheetService);
    (service as any).prisma = mockPrisma;
    (service as any).audit = mockAudit;
    (service as any).cache = mockCache;
    (service as any).crewCashDistribution = mockCrewCash;
    (service as any).discrepancyCases = mockDiscrepancyCases;
  });

  afterEach(() => jest.clearAllMocks());

  it('creates discrepancy cases inside the SAME transaction as the isClosed flip, and includes the summary in the return value', async () => {
    mockDiscrepancyCases.createCasesForSheet.mockResolvedValue({ createdCount: 2, types: ['BOTTLE', 'CASH'] });

    const result = await service.closeSheet(VENDOR_ID, SHEET_ID, ACTOR_ID, ACTOR_ROLE, ACTUAL_CASH_HANDED_IN);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDiscrepancyCases.createCasesForSheet).toHaveBeenCalledWith(
      tx,
      VENDOR_ID,
      { id: SHEET_ID, driverId: DRIVER_ID },
      // Trip feature: the reconciliation fed into case creation must reflect
      // the ACTUAL cash hand-in passed into closeSheet, not the sheet's
      // stale/zero DB value — buildReconciliation() runs against an
      // in-memory sheet that's been overlaid with it before this call.
      expect.objectContaining({
        bottles: expect.anything(),
        empties: expect.anything(),
        driver: expect.objectContaining({ handedIn: ACTUAL_CASH_HANDED_IN }),
      }),
      ACTOR_ID,
      ACTOR_ROLE,
    );

    expect(result.discrepancyCasesCreated).toBe(2);
    // existing fields preserved
    expect(result.sheet).toEqual(expect.objectContaining({ isClosed: true }));
    expect(result.reconciliation).toBeDefined();
    expect(result.syncedCrewCashCount).toBe(0);
  });

  it('runs discrepancy-case creation AFTER the Crew Cash sync, both inside the same transaction callback', async () => {
    await service.closeSheet(VENDOR_ID, SHEET_ID, ACTOR_ID, ACTOR_ROLE, ACTUAL_CASH_HANDED_IN);

    const syncOrder = mockCrewCash.syncSheetToLedger.mock.invocationCallOrder[0];
    const discrepancyOrder = mockDiscrepancyCases.createCasesForSheet.mock.invocationCallOrder[0];
    expect(syncOrder).toBeLessThan(discrepancyOrder);
  });

  it('rolls back the isClosed flip when discrepancy-case creation throws inside the transaction, and never reaches audit/cache', async () => {
    mockDiscrepancyCases.createCasesForSheet.mockRejectedValue(new Error('case creation failed'));

    await expect(service.closeSheet(VENDOR_ID, SHEET_ID, ACTOR_ID, ACTOR_ROLE, ACTUAL_CASH_HANDED_IN)).rejects.toThrow('case creation failed');

    expect(mockAudit.log).not.toHaveBeenCalled();
    expect(mockCache.invalidateDailyDashboard).not.toHaveBeenCalled();
    expect(mockCache.invalidateOverview).not.toHaveBeenCalled();
    expect(mockCache.invalidateAnalytics).not.toHaveBeenCalled();
  });

  it('returns discrepancyCasesCreated: 0 when the sheet reconciled clean', async () => {
    mockDiscrepancyCases.createCasesForSheet.mockResolvedValue({ createdCount: 0, types: [] });

    const result = await service.closeSheet(VENDOR_ID, SHEET_ID, ACTOR_ID, ACTOR_ROLE, ACTUAL_CASH_HANDED_IN);

    expect(result.discrepancyCasesCreated).toBe(0);
  });
});
