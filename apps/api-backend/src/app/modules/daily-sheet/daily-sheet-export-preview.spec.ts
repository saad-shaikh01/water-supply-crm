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

/**
 * Unit tests: DailySheetService.getExportPreview — bottle/cash/payment
 * summary cards added to the Export CSV preview dialog.
 *
 * Bottles/cash figures mirror generateExportCsv's completed+empty_only
 * scope; standalone Record Payment collections are a single vendor+date
 * aggregate, never split per van (a payment has no van of its own).
 */
describe('DailySheetService.getExportPreview', () => {
  let service: DailySheetService;
  let mockPrisma: any;

  const VENDOR_ID = 'vendor-001';
  const VAN_ID = 'van-001';
  const DATE = '2026-08-24';

  beforeEach(async () => {
    mockPrisma = {
      van: { findMany: jest.fn() },
      dailySheet: { findFirst: jest.fn() },
      transaction: { aggregate: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailySheetService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: FcmService, useValue: {} },
        { provide: DeliveryIssueService, useValue: {} },
        { provide: CacheInvalidationService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: InAppNotificationService, useValue: {} },
        { provide: NotificationSettingsService, useValue: {} },
        { provide: CollectionPolicyService, useValue: {} },
        { provide: CrewCashDistributionService, useValue: {} },
        { provide: VehicleCheckService, useValue: {} },
        { provide: SheetDiscrepancyCaseService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: WarehouseService, useValue: {} },
        { provide: DeliveryReceiptPdfService, useValue: {} },
        { provide: getQueueToken(QUEUE_NAMES.DAILY_SHEET_GENERATION), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<DailySheetService>(DailySheetService);
    (service as any).prisma = mockPrisma;
  });

  it('sums bottles/cash from completed+empty_only items only, and adds standalone payments as a single non-van-scoped total', async () => {
    mockPrisma.van.findMany.mockResolvedValue([{ id: VAN_ID, plateNumber: 'V3' }]);
    mockPrisma.dailySheet.findFirst.mockResolvedValue({
      items: [
        { status: 'COMPLETED', filledDropped: 4, emptyReceived: 2, cashCollected: 500 },
        { status: 'EMPTY_ONLY', filledDropped: 0, emptyReceived: 3, cashCollected: 0 },
        { status: 'PENDING', filledDropped: 0, emptyReceived: 0, cashCollected: 0 },
        { status: 'NOT_AVAILABLE', filledDropped: 0, emptyReceived: 0, cashCollected: 0 },
      ],
    });
    mockPrisma.transaction.aggregate.mockResolvedValue({ _sum: { amount: -2000 } });

    const result = await service.getExportPreview(VENDOR_ID, { date: DATE });

    expect(result.perVan[0]).toEqual(
      expect.objectContaining({
        vanId: VAN_ID,
        completed: 2,
        pending: 1,
        cancelled: 1,
        filledDropped: 4,
        emptyReceived: 5,
        cashCollected: 500,
      }),
    );
    expect(result.totals).toEqual({
      completed: 2,
      pending: 1,
      cancelled: 1,
      filledDropped: 4,
      emptyReceived: 5,
      cashCollected: 500,
      standalonePayments: 2000,
    });
    // Positive display value from a negative-stored Transaction.amount.
    expect(mockPrisma.transaction.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ vendorId: VENDOR_ID, type: 'PAYMENT', dailySheetItemId: null }),
      }),
    );
  });

  it('returns all zeros for an empty day with no deliveries and no payments', async () => {
    mockPrisma.van.findMany.mockResolvedValue([{ id: VAN_ID, plateNumber: 'V3' }]);
    mockPrisma.dailySheet.findFirst.mockResolvedValue(null);
    mockPrisma.transaction.aggregate.mockResolvedValue({ _sum: { amount: null } });

    const result = await service.getExportPreview(VENDOR_ID, { date: DATE });

    expect(result.totals).toEqual({
      completed: 0,
      pending: 0,
      cancelled: 0,
      filledDropped: 0,
      emptyReceived: 0,
      cashCollected: 0,
      standalonePayments: 0,
    });
  });

  it('exportType "deliveries" reports standalonePayments as 0 without querying Transaction', async () => {
    mockPrisma.van.findMany.mockResolvedValue([{ id: VAN_ID, plateNumber: 'V3' }]);
    mockPrisma.dailySheet.findFirst.mockResolvedValue({
      items: [{ status: 'COMPLETED', filledDropped: 4, emptyReceived: 2, cashCollected: 500 }],
    });

    const result = await service.getExportPreview(VENDOR_ID, { date: DATE, exportType: 'deliveries' });

    expect(result.totals.completed).toBe(1);
    expect(result.totals.standalonePayments).toBe(0);
    expect(mockPrisma.transaction.aggregate).not.toHaveBeenCalled();
  });

  it('exportType "payments" reports all delivery figures as 0 without querying DailySheet', async () => {
    mockPrisma.van.findMany.mockResolvedValue([{ id: VAN_ID, plateNumber: 'V3' }]);
    mockPrisma.transaction.aggregate.mockResolvedValue({ _sum: { amount: -2000 } });

    const result = await service.getExportPreview(VENDOR_ID, { date: DATE, exportType: 'payments' });

    expect(result.totals).toEqual({
      completed: 0,
      pending: 0,
      cancelled: 0,
      filledDropped: 0,
      emptyReceived: 0,
      cashCollected: 0,
      standalonePayments: 2000,
    });
    expect(mockPrisma.dailySheet.findFirst).not.toHaveBeenCalled();
  });
});
