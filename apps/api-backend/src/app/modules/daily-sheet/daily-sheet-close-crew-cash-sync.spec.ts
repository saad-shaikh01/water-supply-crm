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
 * `CrewCashDistributionService.syncSheetToLedger` — Phase 3-3 of
 * docs/features/crew-operational-cash-distribution.md §6. Verifies the
 * isClosed flip and the sync sweep share one transaction (so a partial sync
 * failure rolls back the close too), and that the sync summary flows into
 * the method's return value alongside the existing shape.
 */
describe('DailySheetService.closeSheet — Crew Cash Ledger sync', () => {
  let service: DailySheetService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockCache: any;
  let mockCrewCash: any;
  let tx: any;

  const VENDOR_ID = 'vendor-001';
  const SHEET_ID = 'sheet-001';
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
        // Not exercised by this suite (Crew Cash sync only) — only wired so
        // Nest can resolve DailySheetService's full constructor and so
        // assertSheetCloseable's END-check gate / the discrepancy-case step
        // inside closeSheet's transaction don't throw (Soft Close Amendment
        // R9 / Sheet Discrepancy Case deps, added after this suite was written).
        {
          provide: VehicleCheckService,
          useValue: {
            assertTripStartClear: jest.fn().mockResolvedValue(undefined),
            assertTripEndClear: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: SheetDiscrepancyCaseService,
          useValue: { createCasesForSheet: jest.fn().mockResolvedValue({ createdCount: 0, types: [] }) },
        },
        { provide: StorageService, useValue: {} },
        { provide: WarehouseService, useValue: {} },
        { provide: DeliveryReceiptPdfService, useValue: {} },
        { provide: getQueueToken(QUEUE_NAMES.DAILY_SHEET_GENERATION), useValue: { add: jest.fn(), getRepeatableJobs: jest.fn().mockResolvedValue([]), upsertJobScheduler: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get<DailySheetService>(DailySheetService);
    (service as any).prisma = mockPrisma;
    (service as any).audit = mockAudit;
    (service as any).cache = mockCache;
    (service as any).crewCashDistribution = mockCrewCash;
  });

  afterEach(() => jest.clearAllMocks());

  it('syncs Crew Cash inside the SAME transaction as the isClosed flip, and includes the sync summary in the return value', async () => {
    mockCrewCash.syncSheetToLedger.mockResolvedValue({ synced: 2, skippedPendingApproval: 1 });

    const result = await service.closeSheet(VENDOR_ID, SHEET_ID, ACTOR_ID, ACTOR_ROLE, ACTUAL_CASH_HANDED_IN);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.dailySheet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SHEET_ID },
        // Trip feature: closeSheet now writes the driver's actual cash
        // hand-in directly (no longer accumulated per-trip check-in).
        data: expect.objectContaining({ isClosed: true, cashCollected: ACTUAL_CASH_HANDED_IN }),
      }),
    );
    expect(mockCrewCash.syncSheetToLedger).toHaveBeenCalledWith(tx, VENDOR_ID, SHEET_ID, ACTOR_ID, ACTOR_ROLE);

    expect(result.sheet).toEqual(expect.objectContaining({ isClosed: true }));
    expect(result.syncedCrewCashCount).toBe(2);
    expect(result.skippedPendingApprovalCount).toBe(1);
    // existing fields preserved
    expect(result.reconciliation).toBeDefined();
  });

  it('runs the sync AFTER the isClosed flip is issued, both inside the same transaction callback', async () => {
    await service.closeSheet(VENDOR_ID, SHEET_ID, ACTOR_ID, ACTOR_ROLE, ACTUAL_CASH_HANDED_IN);

    const updateOrder = tx.dailySheet.update.mock.invocationCallOrder[0];
    const syncOrder = mockCrewCash.syncSheetToLedger.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(syncOrder);
  });

  it('writes the audit log and invalidates caches only AFTER the transaction resolves', async () => {
    await service.closeSheet(VENDOR_ID, SHEET_ID, ACTOR_ID, ACTOR_ROLE, ACTUAL_CASH_HANDED_IN);

    const txOrder = mockPrisma.$transaction.mock.invocationCallOrder[0];
    const auditOrder = mockAudit.log.mock.invocationCallOrder[0];
    const cacheOrder = mockCache.invalidateDailyDashboard.mock.invocationCallOrder[0];
    expect(txOrder).toBeLessThan(auditOrder);
    expect(txOrder).toBeLessThan(cacheOrder);
  });

  it('rolls back the isClosed flip when the Crew Cash sync throws inside the transaction, and never reaches audit/cache', async () => {
    mockCrewCash.syncSheetToLedger.mockRejectedValue(new Error('sync failed'));

    await expect(service.closeSheet(VENDOR_ID, SHEET_ID, ACTOR_ID, ACTOR_ROLE, ACTUAL_CASH_HANDED_IN)).rejects.toThrow('sync failed');

    // The transaction itself is what a real Prisma client would roll back on
    // this rejection — here we assert the failure propagates out of
    // closeSheet() as a whole, and that nothing downstream of the
    // transaction (audit log, cache invalidation) ever runs, proving the
    // close is not treated as having succeeded.
    expect(mockAudit.log).not.toHaveBeenCalled();
    expect(mockCache.invalidateDailyDashboard).not.toHaveBeenCalled();
    expect(mockCache.invalidateOverview).not.toHaveBeenCalled();
    expect(mockCache.invalidateAnalytics).not.toHaveBeenCalled();
  });
});
