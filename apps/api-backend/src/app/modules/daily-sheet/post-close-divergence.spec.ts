import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { DeliveryStatus } from '@prisma/client';
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
 * Unit tests: DailySheetService.findOne — the Post-Close Divergence Banner
 * (Option C). On a CLOSED sheet whose `cashExpected` was frozen at close time,
 * a later void / delivery correction / trip check-in correction updates the
 * customer ledger but NOT that snapshot. findOne() re-runs the pure
 * buildReconciliation on the current data (no extra DB query) and, when it has
 * moved, attaches `postCloseDivergence: { diverged: true, ... }` so the sheet
 * detail page can show an informational banner. It changes no figure and must
 * never break findOne — any failure degrades to { diverged: false }.
 */
describe('DailySheetService.findOne — postCloseDivergence (Option C)', () => {
  let service: DailySheetService;
  let mockPrisma: any;

  const VENDOR_ID = 'vendor-001';
  const SHEET_ID = 'sheet-001';
  const SHEET_DATE = new Date('2026-08-17T00:00:00.000Z');

  function buildItem(overrides: Record<string, unknown> = {}) {
    return {
      id: `item-${Math.random().toString(36).slice(2)}`,
      status: DeliveryStatus.COMPLETED,
      voidedAt: null,
      isCorrection: false,
      correctionAddedAt: null,
      customerId: 'customer-001',
      productId: 'product-001',
      filledDropped: 0,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 0,
      pricePerBottle: 100,
      whatsappSentAt: null,
      _count: { notes: 0 },
      customer: { id: 'customer-001', paymentType: 'CASH', customPrices: [] },
      product: { id: 'product-001', basePrice: 100 },
      ...overrides,
    };
  }

  function buildSheet(overrides: Record<string, unknown> = {}) {
    return {
      id: SHEET_ID,
      vendorId: VENDOR_ID,
      date: SHEET_DATE,
      isClosed: true,
      cashExpected: 5000,
      cashCollected: 5000,
      filledOutCount: 0,
      filledInCount: 0,
      emptyInCount: 0,
      items: [],
      loads: [],
      expenses: [],
      crewCashDistributions: [],
      movedOutLogs: [],
      movedInLogs: [],
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockPrisma = {
      dailySheet: { findFirst: jest.fn() },
      conversationMessage: { groupBy: jest.fn().mockResolvedValue([]) },
      notificationLog: { findMany: jest.fn().mockResolvedValue([]) },
      dailySheetItem: { findMany: jest.fn().mockResolvedValue([]) },
      transaction: { groupBy: jest.fn().mockResolvedValue([]) },
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
        {
          provide: CollectionPolicyService,
          useValue: {
            getPolicy: jest.fn().mockResolvedValue(null),
            getCashPolicy: jest.fn().mockResolvedValue(null),
          },
        },
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

  afterEach(() => jest.clearAllMocks());

  it('closed sheet + a post-close void that drops expected cash by 500 → diverged', async () => {
    const sheet = buildSheet({
      cashExpected: 5000,
      items: [
        // live non-voided cash still recorded = 4500
        buildItem({ status: DeliveryStatus.COMPLETED, cashCollected: 4500 }),
        // voided stop — its 500 no longer counts toward what the driver owes
        buildItem({ status: DeliveryStatus.VOIDED, voidedAt: new Date(), cashCollected: 500 }),
      ],
    });
    mockPrisma.dailySheet.findFirst.mockResolvedValue(sheet);

    const result: any = await service.findOne(VENDOR_ID, SHEET_ID);

    expect(result.postCloseDivergence).toBeDefined();
    expect(result.postCloseDivergence.diverged).toBe(true);
    expect(result.postCloseDivergence.cashExpectedAtClose).toBe(5000);
    expect(result.postCloseDivergence.cashExpectedNow).toBe(4500);
    expect(result.postCloseDivergence.cashDelta).toBe(-500);
    expect(result.postCloseDivergence.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/voided/i)]),
    );
  });

  it('closed sheet, no voids/corrections, live recon === cashExpected → not diverged', async () => {
    const sheet = buildSheet({
      cashExpected: 4500,
      items: [buildItem({ status: DeliveryStatus.COMPLETED, cashCollected: 4500 })],
    });
    mockPrisma.dailySheet.findFirst.mockResolvedValue(sheet);

    const result: any = await service.findOne(VENDOR_ID, SHEET_ID);

    expect(result.postCloseDivergence).toEqual({ diverged: false });
  });

  it('open sheet → no postCloseDivergence attached at all', async () => {
    const sheet = buildSheet({
      isClosed: false,
      cashExpected: null,
      items: [buildItem({ status: DeliveryStatus.COMPLETED, cashCollected: 4500 })],
    });
    mockPrisma.dailySheet.findFirst.mockResolvedValue(sheet);

    const result: any = await service.findOne(VENDOR_ID, SHEET_ID);

    expect(result.postCloseDivergence).toBeUndefined();
  });

  it('buildReconciliation throws → findOne still returns, { diverged: false }', async () => {
    const sheet = buildSheet({
      cashExpected: 5000,
      items: [buildItem({ status: DeliveryStatus.COMPLETED, cashCollected: 4500 })],
    });
    mockPrisma.dailySheet.findFirst.mockResolvedValue(sheet);
    jest.spyOn(service as any, 'buildReconciliation').mockImplementation(() => {
      throw new Error('boom');
    });

    const result: any = await service.findOne(VENDOR_ID, SHEET_ID);

    expect(result).toBeDefined();
    expect(result.id).toBe(SHEET_ID);
    expect(result.postCloseDivergence).toEqual({ diverged: false });
  });
});
