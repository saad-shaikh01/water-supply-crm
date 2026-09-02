import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
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
import { AnalyticsService } from '../analytics/analytics.service';
import { CustomerPortalService } from '../customer-portal/customer-portal.service';
import { CustomerService } from '../customer/customer.service';

/**
 * Unit tests: aggregate/reporting surfaces that must exclude VOIDED
 * DailySheetItems after the Void Delivery feature.
 *
 *  - buildReconciliation.totalCashRecorded / driver.discrepancy
 *  - findAllPaginated._count.items (excludes voided) + itemCounts.voided
 *  - analytics.getDeliveries — status: { not: 'VOIDED' } on the item query
 *  - customer-portal.getDeliveries — status: { not: 'VOIDED' } on the item query
 *
 * PDF (daily-sheet-pdf.service.generate) filters voided rows before
 * drawDeliveryTable and out of the Stops / GROSS CASH card; it needs a live
 * PDFKit document to exercise and is covered by the manual checklist instead.
 */

const DAILY_SHEET_PROVIDERS = (mockPrisma: any, extra: Record<string, any> = {}) => [
  DailySheetService,
  { provide: PrismaService, useValue: mockPrisma },
  { provide: LedgerService, useValue: extra.ledger ?? {} },
  { provide: AuditService, useValue: extra.audit ?? {} },
  { provide: FcmService, useValue: {} },
  { provide: DeliveryIssueService, useValue: {} },
  { provide: CacheInvalidationService, useValue: extra.cache ?? {} },
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
];

// ── buildReconciliation ─────────────────────────────────────────────────────
describe('DailySheetService.buildReconciliation — voided items', () => {
  let service: DailySheetService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: DAILY_SHEET_PROVIDERS({}),
    }).compile();
    service = module.get<DailySheetService>(DailySheetService);
  });

  function item(status: string, cashCollected: number) {
    return {
      status,
      filledDropped: status === 'COMPLETED' ? 2 : 0,
      filledReceived: 0,
      emptyReceived: 0,
      cashCollected,
      pricePerBottle: 100,
      customer: { paymentType: 'CASH', customPrices: [] },
      product: { basePrice: 100 },
    };
  }

  it('excludes a VOIDED item\'s stale cashCollected from totalCashRecorded / driver.discrepancy', () => {
    const sheet = {
      filledOutCount: 0,
      filledInCount: 0,
      emptyInCount: 0,
      cashCollected: 500, // driver actually handed in 500
      expenses: [],
      crewCashDistributions: [],
      items: [
        item('COMPLETED', 500),
        item('VOIDED', 300), // reversed — stale column value must not count
      ],
    };

    const recon = (service as any).buildReconciliation(sheet);

    // shouldHandIn = sum of non-voided cashCollected = 500 (not 800)
    expect(recon.driver.shouldHandIn).toBe(500);
    // discrepancy = 500 recorded - 500 handed in = 0
    expect(recon.driver.discrepancy).toBe(0);
  });
});

// ── findAllPaginated ───────────────────────────────────────────────────────
describe('DailySheetService.findAllPaginated — voided items', () => {
  let service: DailySheetService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      dailySheet: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(1) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: DAILY_SHEET_PROVIDERS(mockPrisma),
    }).compile();
    service = module.get<DailySheetService>(DailySheetService);
    (service as any).prisma = mockPrisma;
  });

  it('_count.items excludes voided; itemCounts.voided counts them', async () => {
    mockPrisma.dailySheet.findMany.mockResolvedValue([
      {
        id: 'sheet-1',
        route: null,
        van: null,
        driver: null,
        crew: [],
        loads: [],
        items: [
          { status: 'COMPLETED', deliveryType: 'SCHEDULED', deliveryIssue: null },
          { status: 'PENDING', deliveryType: 'SCHEDULED', deliveryIssue: null },
          { status: 'VOIDED', deliveryType: 'SCHEDULED', deliveryIssue: null },
          { status: 'VOIDED', deliveryType: 'SCHEDULED', deliveryIssue: null },
        ],
      },
    ]);

    const res = await service.findAllPaginated('vendor-1', {} as any);
    const row = res.data[0] as any;

    expect(row._count.items).toBe(2); // 4 items - 2 voided
    expect(row.itemCounts.voided).toBe(2);
    expect(row.itemCounts.completed).toBe(1);
    expect(row.itemCounts.pending).toBe(1);
  });
});

// ── findAllPaginated — hybrid cash (post-close-modified rows) ──────────────
describe('DailySheetService.findAllPaginated — hybrid cash', () => {
  let service: DailySheetService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      dailySheet: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(1) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: DAILY_SHEET_PROVIDERS(mockPrisma),
    }).compile();
    service = module.get<DailySheetService>(DailySheetService);
    (service as any).prisma = mockPrisma;
  });

  const row = (over: any) => ({
    id: 's1',
    isClosed: true,
    cashCollected: 999, // frozen close-time snapshot
    route: null,
    van: null,
    driver: null,
    crew: [],
    loads: [{ endedAt: null, editCount: 0 }],
    items: [],
    ...over,
  });

  it('closed sheet with a voided item → cashCollected = Σ non-voided item cash, postCloseModified true', async () => {
    mockPrisma.dailySheet.findMany.mockResolvedValue([
      row({
        items: [
          { status: 'COMPLETED', deliveryType: 'SCHEDULED', deliveryIssue: null, cashCollected: 300, voidedAt: null, isCorrection: false, correctionAddedAt: null },
          { status: 'EMPTY_ONLY', deliveryType: 'SCHEDULED', deliveryIssue: null, cashCollected: 0, voidedAt: null, isCorrection: false, correctionAddedAt: null },
          { status: 'VOIDED', deliveryType: 'SCHEDULED', deliveryIssue: null, cashCollected: 200, voidedAt: new Date(), isCorrection: false, correctionAddedAt: null },
        ],
      }),
    ]);

    const res = await service.findAllPaginated('vendor-1', {} as any);
    const r = res.data[0] as any;

    expect(r.postCloseModified).toBe(true);
    expect(r.cashCollected).toBe(300); // 300 + 0, voided 200 excluded — NOT the frozen 999
  });

  it('untouched closed sheet → cashCollected stays frozen, postCloseModified false', async () => {
    mockPrisma.dailySheet.findMany.mockResolvedValue([
      row({
        items: [
          { status: 'COMPLETED', deliveryType: 'SCHEDULED', deliveryIssue: null, cashCollected: 300, voidedAt: null, isCorrection: false, correctionAddedAt: null },
        ],
      }),
    ]);

    const res = await service.findAllPaginated('vendor-1', {} as any);
    const r = res.data[0] as any;

    expect(r.postCloseModified).toBe(false);
    expect(r.cashCollected).toBe(999); // frozen, untouched
  });
});

// ── getDriverStats — voided stops excluded from totals ────────────────────
describe('DailySheetService.getDriverStats — voided items', () => {
  let service: DailySheetService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      dailySheetItem: {
        groupBy: jest.fn(({ by }: any) => {
          if (by[0] === 'status') {
            return Promise.resolve([
              { status: 'COMPLETED', _count: { id: 5 }, _sum: { filledDropped: 10, emptyReceived: 8, filledReceived: 0 } },
              { status: 'NOT_AVAILABLE', _count: { id: 2 }, _sum: { filledDropped: 0, emptyReceived: 0, filledReceived: 0 } },
            ]);
          }
          return Promise.resolve([]); // failureCategory + dailySheetId groups
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      dailySheetLoad: { findMany: jest.fn().mockResolvedValue([]) },
      dailySheet: {
        aggregate: jest.fn().mockResolvedValue({ _count: { id: 1 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: DAILY_SHEET_PROVIDERS(mockPrisma),
    }).compile();
    service = module.get<DailySheetService>(DailySheetService);
    (service as any).prisma = mockPrisma;
  });

  it('itemStats groupBy filters out VOIDED so totalItems / successRate ignore voided stops', async () => {
    const res: any = await service.getDriverStats('vendor-1', 'driver-1', {});

    const statusGroupBy = mockPrisma.dailySheetItem.groupBy.mock.calls.find(
      (c: any[]) => c[0].by[0] === 'status',
    );
    expect(statusGroupBy[0].where.status).toEqual({ not: 'VOIDED' });

    const failureGroupBy = mockPrisma.dailySheetItem.groupBy.mock.calls.find(
      (c: any[]) => c[0].by[0] === 'failureCategory',
    );
    expect(failureGroupBy[0].where.status).toEqual({ not: 'VOIDED' });

    expect(res.totalItems).toBe(7); // 5 completed + 2 not-available, no voided group
    expect(res.deliveredCount).toBe(5);
    expect(res.successRate).toBe(71); // round(5/7*100)
  });
});

// ── analytics.getDeliveries ────────────────────────────────────────────────
describe('AnalyticsService.getDeliveries — voided items', () => {
  let service: AnalyticsService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      dailySheetItem: { findMany: jest.fn().mockResolvedValue([]) },
      deliveryIssue: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const mockCache = {
      vendorKey: jest.fn().mockReturnValue('k'),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheInvalidationService, useValue: mockCache },
      ],
    }).compile();
    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('passes status: { not: "VOIDED" } to dailySheetItem.findMany', async () => {
    await service.getDeliveries('vendor-1');
    const whereArg = mockPrisma.dailySheetItem.findMany.mock.calls[0][0].where;
    expect(whereArg.status).toEqual({ not: 'VOIDED' });
  });

  it('total / completionRate are computed only over the returned (non-voided) items', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([
      { status: 'COMPLETED', deliveryType: 'SCHEDULED', reason: null, filledDropped: 1, emptyReceived: 0, filledReceived: 0, dailySheet: { date: new Date('2026-08-17'), route: null } },
      { status: 'EMPTY_ONLY', deliveryType: 'SCHEDULED', reason: null, filledDropped: 0, emptyReceived: 1, filledReceived: 0, dailySheet: { date: new Date('2026-08-17'), route: null } },
      { status: 'NOT_AVAILABLE', deliveryType: 'SCHEDULED', reason: null, filledDropped: 0, emptyReceived: 0, filledReceived: 0, dailySheet: { date: new Date('2026-08-17'), route: null } },
    ]);

    const res: any = await service.getDeliveries('vendor-1');
    expect(res.summary.total).toBe(3);
    expect(res.summary.completed).toBe(2);
    expect(res.summary.completionRate).toBe(67); // 2/3
  });
});

// ── customer-portal.getDeliveries ─────────────────────────────────────────
describe('CustomerPortalService.getDeliveries — voided items', () => {
  let service: CustomerPortalService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }) },
      dailySheetItem: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerPortalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CustomerService, useValue: {} },
      ],
    }).compile();
    service = module.get<CustomerPortalService>(CustomerPortalService);
  });

  it('passes status: { not: "VOIDED" } to dailySheetItem.findMany', async () => {
    await service.getDeliveries('user-1', {} as any);
    const whereArg = mockPrisma.dailySheetItem.findMany.mock.calls[0][0].where;
    expect(whereArg.status).toEqual({ not: 'VOIDED' });
  });
});
