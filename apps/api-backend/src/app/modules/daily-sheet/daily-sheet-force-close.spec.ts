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
import { StaffAttendanceService } from '../payroll/staff-attendance.service';
import { VehicleCheckService } from '../fleet/vehicle-check.service';
import { SheetDiscrepancyCaseService } from '../sheet-discrepancy-case/sheet-discrepancy-case.service';
import { VanCashLedgerService } from '../van-cash-ledger/van-cash-ledger.service';
import { CustomerDepositsService } from '../customer-deposits/customer-deposits.service';
import { StorageService } from '../../common/storage/storage.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { DeliveryReceiptPdfService } from '../whatsapp/delivery-receipt-pdf.service';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { DailySheetKind, DeliveryStatus, PaymentType, UserRole } from '@prisma/client';

/**
 * Stale-sheet force close (admin tool): waives the PENDING-items and END
 * vehicle-check gates, cancels the PENDING stops inside the close transaction,
 * and accepts bottle/empty counts as recorded — while still running the normal
 * closeSheet() composition (crew-cash sync, Cash Ledger handover, cash case).
 */
describe('DailySheetService — force close of a stale sheet', () => {
  let service: DailySheetService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockCrewCash: any;
  let mockDiscrepancyCases: any;
  let mockVehicleCheck: any;
  let mockVanCashLedger: any;
  let tx: any;

  const VENDOR_ID = 'vendor-001';
  const SHEET_ID = 'sheet-001';
  const USER: any = { userId: 'admin-001', vendorId: VENDOR_ID, role: UserRole.VENDOR_ADMIN };
  const PAST_DATE = new Date('2026-08-06T00:00:00.000Z');

  function item(status: DeliveryStatus, over: Record<string, unknown> = {}) {
    return {
      id: `item-${Math.random()}`,
      status,
      filledDropped: 0,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 0,
      pricePerBottle: 0,
      productId: 'p1',
      customer: { paymentType: PaymentType.CASH, customPrices: [] },
      product: { basePrice: 0 },
      ...over,
    };
  }

  function buildSheet(over: Record<string, unknown> = {}) {
    return {
      id: SHEET_ID,
      vendorId: VENDOR_ID,
      driverId: 'driver-001',
      date: PAST_DATE,
      kind: DailySheetKind.ROUTE,
      isClosed: false,
      filledOutCount: 0,
      filledInCount: 0,
      emptyInCount: 0,
      cashCollected: 0,
      items: [
        item(DeliveryStatus.COMPLETED, { filledDropped: 10, emptyReceived: 8, cashCollected: 1900, pricePerBottle: 190 }),
        item(DeliveryStatus.PENDING),
        item(DeliveryStatus.PENDING),
      ],
      expenses: [{ amount: 100, paidFromCash: true }],
      crewCashDistributions: [{ amount: 300 }],
      sheetAdvances: [],
      ...over,
    };
  }

  beforeEach(async () => {
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockCrewCash = { syncSheetToLedger: jest.fn().mockResolvedValue({ synced: 0, skippedPendingApproval: 0 }) };
    mockDiscrepancyCases = { createCasesForSheet: jest.fn().mockResolvedValue({ createdCount: 0, types: [] }) };
    mockVehicleCheck = {
      assertTripStartClear: jest.fn().mockResolvedValue(undefined),
      assertTripEndClear: jest.fn().mockRejectedValue(new Error('END check required')),
    };
    mockVanCashLedger = { createHandoverForClosedSheet: jest.fn().mockResolvedValue(null) };

    tx = {
      dailySheet: { update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: SHEET_ID, ...data })) },
      dailySheetItem: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };

    mockPrisma = {
      dailySheet: {
        findFirst: jest.fn().mockResolvedValue(buildSheet()),
        findUnique: jest.fn().mockResolvedValue({ van: { plateNumber: 'ABC-1' }, driver: { name: 'Ali' } }),
      },
      dailySheetLoad: { findFirst: jest.fn().mockResolvedValue(null) },
      vehicleDailyCheck: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailySheetService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: {} },
        { provide: AuditService, useValue: mockAudit },
        { provide: FcmService, useValue: {} },
        { provide: DeliveryIssueService, useValue: { createForItem: jest.fn(), autoResolveOnSuccess: jest.fn() } },
        {
          provide: CacheInvalidationService,
          useValue: {
            invalidateDailyDashboard: jest.fn().mockResolvedValue(undefined),
            invalidateOverview: jest.fn().mockResolvedValue(undefined),
            invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationService, useValue: {} },
        { provide: InAppNotificationService, useValue: {} },
        { provide: NotificationSettingsService, useValue: {} },
        { provide: CollectionPolicyService, useValue: {} },
        { provide: CrewCashDistributionService, useValue: mockCrewCash },
        { provide: StaffAttendanceService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: WarehouseService, useValue: {} },
        { provide: DeliveryReceiptPdfService, useValue: {} },
        { provide: VehicleCheckService, useValue: mockVehicleCheck },
        { provide: SheetDiscrepancyCaseService, useValue: mockDiscrepancyCases },
        { provide: VanCashLedgerService, useValue: mockVanCashLedger },
        { provide: CustomerDepositsService, useValue: { syncDeliveryEntriesTx: jest.fn() } },
        {
          provide: getQueueToken(QUEUE_NAMES.DAILY_SHEET_GENERATION),
          useValue: { add: jest.fn(), getRepeatableJobs: jest.fn().mockResolvedValue([]), upsertJobScheduler: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<DailySheetService>(DailySheetService);
    (service as any).prisma = mockPrisma;
    (service as any).audit = mockAudit;
    (service as any).crewCashDistribution = mockCrewCash;
    (service as any).discrepancyCases = mockDiscrepancyCases;
    (service as any).vanCashLedger = mockVanCashLedger;
  });

  afterEach(() => jest.clearAllMocks());

  it('the NORMAL close still refuses a sheet with PENDING stops (regression)', async () => {
    await expect(service.closeSheet(VENDOR_ID, SHEET_ID, USER.userId, USER.role, 0)).rejects.toThrow(/still PENDING/);
    expect(tx.dailySheetItem.updateMany).not.toHaveBeenCalled();
  });

  it('cancels PENDING stops in the same transaction, skips the END vehicle check and closes with the expected hand-in', async () => {
    const result = await service.forceCloseSheet(USER, SHEET_ID, { reason: 'Sheet never closed in Sept' });

    expect(mockVehicleCheck.assertTripEndClear).not.toHaveBeenCalled();
    expect(tx.dailySheetItem.updateMany).toHaveBeenCalledWith({
      where: { dailySheetId: SHEET_ID, status: DeliveryStatus.PENDING },
      data: { status: DeliveryStatus.CANCELLED },
    });
    // 1900 delivery cash − 100 van expense − 300 crew cash = 1500 expected hand-in.
    const update = tx.dailySheet.update.mock.calls[0][0].data;
    expect(update).toMatchObject({ isClosed: true, cashCollected: 1500, cashExpected: 1500, closureStatus: 'APPROVED' });
    expect(mockCrewCash.syncSheetToLedger).toHaveBeenCalled();
    expect(mockVanCashLedger.createHandoverForClosedSheet).toHaveBeenCalled();
    expect(result.cancelledPendingCount).toBe(2);
  });

  it('accepts bottle/empty counts as recorded (no stock discrepancy) but keeps the cash discrepancy', async () => {
    await service.forceCloseSheet(USER, SHEET_ID, { reason: 'Sheet never closed in Sept', actualCashHandedIn: 1000 });
    const input = mockDiscrepancyCases.createCasesForSheet.mock.calls[0][3];
    expect(input.bottles.discrepancy).toBe(0);
    expect(input.empties.discrepancy).toBe(0);
    // 1500 expected − 1000 actually handed in: 500 stays unexplained, so a cash case is still raised.
    expect(input.driver.unexplainedDiscrepancy).toBe(500);
  });

  it('writes a FORCE_CLOSE audit entry with the reason and what was waived', async () => {
    await service.forceCloseSheet(USER, SHEET_ID, { reason: 'Sheet never closed in Sept' });
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FORCE_CLOSE',
        entityId: SHEET_ID,
        changes: {
          after: expect.objectContaining({
            reason: 'Sheet never closed in Sept',
            cancelledPendingCount: 2,
            expectedHandIn: 1500,
            vehicleCheckWaived: true,
            stockDiscrepancyAccepted: true,
          }),
        },
      }),
    );
  });

  it("refuses today's sheet and an already-closed sheet", async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet({ date: new Date() }));
    await expect(service.forceCloseSheet(USER, SHEET_ID, { reason: 'Sheet never closed in Sept' })).rejects.toThrow(
      /previous day/,
    );
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet({ isClosed: true }));
    await expect(service.forceCloseSheet(USER, SHEET_ID, { reason: 'Sheet never closed in Sept' })).rejects.toThrow(
      /already closed/,
    );
    expect(tx.dailySheetItem.updateMany).not.toHaveBeenCalled();
  });

  it('refuses while a trip is still active', async () => {
    mockPrisma.dailySheetLoad.findFirst.mockResolvedValue({ id: 'load-1' });
    await expect(service.forceCloseSheet(USER, SHEET_ID, { reason: 'Sheet never closed in Sept' })).rejects.toThrow(
      /trip is still active/,
    );
  });

  it('bulk: one failing sheet does not stop the others', async () => {
    mockPrisma.dailySheet.findFirst
      .mockResolvedValueOnce(buildSheet())
      .mockResolvedValueOnce(buildSheet()) // assertSheetCloseable inside closeSheet for sheet 1
      .mockResolvedValueOnce(null); // sheet 2 not found
    const r = await service.forceCloseBulk(USER, ['a', 'b'], 'Sheet never closed in Sept');
    expect(r).toMatchObject({ total: 2, closed: 1, failed: 1 });
    expect(r.results[1]).toMatchObject({ sheetId: 'b', ok: false });
  });

  it('preview reports what will happen without writing anything', async () => {
    const p = await service.getForceClosePreview(VENDOR_ID, SHEET_ID);
    expect(p).toMatchObject({
      eligible: true,
      pendingCount: 2,
      recordedCount: 1,
      vanPlateNumber: 'ABC-1',
      cash: { deliveryCashRecorded: 1900, vanExpenses: 100, crewCash: 300, expectedHandIn: 1500 },
      vehicleCheck: { required: true, endCheckRecorded: false },
    });
    expect(tx.dailySheetItem.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
