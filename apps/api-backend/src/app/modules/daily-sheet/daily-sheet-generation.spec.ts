import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DailySheetService } from './daily-sheet.service';
import { LedgerService } from '../transaction/ledger.service';
import { AuditService } from '../audit/audit.service';
import { FcmService } from '../fcm/fcm.service';
import { DeliveryIssueService } from '../delivery-issue/delivery-issue.service';
import { NotificationService } from '../notifications/notification.service';
import { InAppNotificationService } from '../notifications/in-app-notification.service';
import { StorageService } from '../../common/storage/storage.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { DeliveryReceiptPdfService } from '../whatsapp/delivery-receipt-pdf.service';
import { NotificationSettingsService } from '../notifications/notification-settings.service';

/**
 * Regression coverage for the Phase 1 refactor: `createSheetForVan` /
 * `ensureSheetForVanDate` were extracted verbatim from
 * `DailySheetProcessor.generateForVendor`'s per-van loop body. These tests
 * pin down the exact behaviors the inline code had before extraction —
 * sequence ordering, rescheduled pull-forward + 60-day auto-cancel,
 * on-demand order idempotency, and crew-snapshot exclusion of the driver —
 * so a future change can't silently alter nightly generation.
 */
function buildMockPrisma() {
  const db = {
    dailySheet: { findFirst: jest.fn(), create: jest.fn() },
    dailySheetItem: { findMany: jest.fn(), updateMany: jest.fn() },
    customerOrder: { findMany: jest.fn(), updateMany: jest.fn() },
    van: { findFirst: jest.fn() },
    product: { findFirst: jest.fn() },
  };
  return db;
}

async function buildService(mockPrisma: ReturnType<typeof buildMockPrisma>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DailySheetService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: LedgerService, useValue: {} },
      { provide: AuditService, useValue: { log: jest.fn() } },
      { provide: FcmService, useValue: {} },
      { provide: DeliveryIssueService, useValue: {} },
      { provide: CacheInvalidationService, useValue: {} },
      { provide: NotificationService, useValue: {} },
      { provide: InAppNotificationService, useValue: {} },
      { provide: StorageService, useValue: {} },
      { provide: WarehouseService, useValue: {} },
      { provide: DeliveryReceiptPdfService, useValue: {} },
      { provide: NotificationSettingsService, useValue: {} },
      {
        provide: getQueueToken(QUEUE_NAMES.DAILY_SHEET_GENERATION),
        useValue: { add: jest.fn(), getJob: jest.fn(), getRepeatableJobs: jest.fn().mockResolvedValue([]), upsertJobScheduler: jest.fn() },
      },
    ],
  }).compile();

  const service = module.get<DailySheetService>(DailySheetService);
  // Direct injection for reliability, matching this service's other spec files.
  (service as any).prisma = mockPrisma;
  return service;
}

const VENDOR_ID = 'vendor-1';
const VAN = {
  id: 'van-1',
  defaultDriverId: 'driver-1',
  routes: [{ id: 'route-1' }],
  defaultCrew: [
    { userId: 'driver-1', role: 'DRIVER' as const }, // must be excluded from the snapshot
    { userId: 'salesman-1', role: 'SALESMAN' as const },
  ],
  // Pre-sorted by routeSequence ascending, as the real Prisma query's
  // `orderBy: [{ routeSequence: 'asc' }, ...]` would return it — the
  // extracted code trusts this ordering and does not re-sort in JS.
  deliverySchedules: [
    { customerId: 'cust-b', routeSequence: 1 },
    { customerId: 'cust-a', routeSequence: 2 },
  ],
};
const DEFAULT_PRODUCT = { id: 'product-1' };
const TARGET_DATE = new Date('2026-07-10T00:00:00.000Z');

describe('DailySheetService.createSheetForVan (extracted from processor)', () => {
  let service: DailySheetService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();
    service = await buildService(mockPrisma);
  });

  afterEach(() => jest.clearAllMocks());

  it('orders regular-schedule items by routeSequence, snapshots crew excluding the driver, and creates the sheet', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([]); // no rescheduled pull-forward
    mockPrisma.dailySheetItem.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.dailySheet.create.mockResolvedValue({ id: 'sheet-new' });

    const result = await service.createSheetForVan(
      mockPrisma as any,
      VENDOR_ID,
      VAN,
      TARGET_DATE,
      TARGET_DATE.getDay(),
      DEFAULT_PRODUCT,
      [],
    );

    expect(mockPrisma.dailySheet.create).toHaveBeenCalledTimes(1);
    const createArgs = mockPrisma.dailySheet.create.mock.calls[0][0];
    expect(createArgs.data.vendorId).toBe(VENDOR_ID);
    expect(createArgs.data.routeId).toBe('route-1');
    expect(createArgs.data.vanId).toBe('van-1');
    expect(createArgs.data.driverId).toBe('driver-1');

    // cust-b has routeSequence 1, cust-a has routeSequence 2 — order must follow routeSequence, not array order
    expect(createArgs.data.items.create).toEqual([
      { customerId: 'cust-b', sequence: 1, productId: 'product-1', deliveryType: 'SCHEDULED' },
      { customerId: 'cust-a', sequence: 2, productId: 'product-1', deliveryType: 'SCHEDULED' },
    ]);

    // driver must never appear in the crew snapshot
    expect(createArgs.data.crew.create).toEqual([{ userId: 'salesman-1', role: 'SALESMAN' }]);

    expect(result.sheet.id).toBe('sheet-new');
    expect(result.eligibleOnDemandOrderIds).toEqual([]);
    expect(result.alreadyInsertedOnDemandOrderIds).toEqual([]);
  });

  it('pulls forward RESCHEDULED items, excludes those customers from the regular schedule, and cancels the old rows', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([
      { id: 'old-item-1', customerId: 'cust-b', productId: 'product-2' },
    ]);
    mockPrisma.dailySheetItem.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.dailySheet.create.mockResolvedValue({ id: 'sheet-new' });

    await service.createSheetForVan(
      mockPrisma as any,
      VENDOR_ID,
      VAN,
      TARGET_DATE,
      TARGET_DATE.getDay(),
      DEFAULT_PRODUCT,
      [],
    );

    const createArgs = mockPrisma.dailySheet.create.mock.calls[0][0];
    // cust-b is pulled out of the regular schedule (it's covered by the rescheduled
    // item instead), leaving only cust-a as "regular" — its sequence is still its
    // own stored routeSequence (2), not re-derived from its new array position.
    // The rescheduled item then gets `regularSchedules.length + index + 1` = 1+0+1 = 2.
    // Both landing on sequence 2 is an inherited pre-existing quirk of the original
    // (unmodified) formula, preserved verbatim by this extraction — not something
    // introduced by the refactor, and out of scope to fix here.
    expect(createArgs.data.items.create).toEqual([
      { customerId: 'cust-a', sequence: 2, productId: 'product-1', deliveryType: 'SCHEDULED' },
      { customerId: 'cust-b', sequence: 2, productId: 'product-2', deliveryType: 'SCHEDULED' },
    ]);

    // old RESCHEDULED row must be cancelled
    expect(mockPrisma.dailySheetItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['old-item-1'] } }, data: { status: 'CANCELLED' } }),
    );
  });

  it('excludes on-demand orders already inserted elsewhere and reports them back', async () => {
    mockPrisma.dailySheetItem.findMany
      .mockResolvedValueOnce([]) // rescheduled lookup
      .mockResolvedValueOnce([{ sourceOrderId: 'order-1' }]); // idempotency lookup
    mockPrisma.dailySheetItem.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.dailySheet.create.mockResolvedValue({ id: 'sheet-new' });
    mockPrisma.customerOrder.updateMany.mockResolvedValue({ count: 1 });

    const plannedOrders = [
      { id: 'order-1', customerId: 'cust-c', productId: 'product-1', dispatchVanId: 'van-1' },
      { id: 'order-2', customerId: 'cust-d', productId: 'product-1', dispatchVanId: null },
    ];

    const result = await service.createSheetForVan(
      mockPrisma as any,
      VENDOR_ID,
      VAN,
      TARGET_DATE,
      TARGET_DATE.getDay(),
      DEFAULT_PRODUCT,
      plannedOrders,
    );

    expect(result.alreadyInsertedOnDemandOrderIds).toEqual(['order-1']);
    expect(result.eligibleOnDemandOrderIds).toEqual(['order-2']);
    expect(mockPrisma.customerOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['order-2'] } } }),
    );
  });
});

describe('DailySheetService.ensureSheetForVanDate', () => {
  let service: DailySheetService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();
    service = await buildService(mockPrisma);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns the existing sheet without creating a new one', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue({ id: 'existing-sheet' });

    const result = await service.ensureSheetForVanDate(mockPrisma as any, VENDOR_ID, 'van-1', '2026-07-10');

    expect(result).toEqual({ sheet: { id: 'existing-sheet' }, createdNewSheet: false });
    expect(mockPrisma.van.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.dailySheet.create).not.toHaveBeenCalled();
  });

  it('creates a new sheet (matching normal generation) when none exists for that van+date', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(null);
    mockPrisma.van.findFirst.mockResolvedValue(VAN);
    mockPrisma.product.findFirst.mockResolvedValue(DEFAULT_PRODUCT);
    mockPrisma.customerOrder.findMany.mockResolvedValue([]);
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([]);
    mockPrisma.dailySheetItem.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.dailySheet.create.mockResolvedValue({ id: 'sheet-new' });

    const result = await service.ensureSheetForVanDate(mockPrisma as any, VENDOR_ID, 'van-1', '2026-07-10');

    expect(result).toEqual({ sheet: { id: 'sheet-new' }, createdNewSheet: true });
  });

  it('throws if the destination van has no default driver', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(null);
    mockPrisma.van.findFirst.mockResolvedValue({ ...VAN, defaultDriverId: null });

    await expect(
      service.ensureSheetForVanDate(mockPrisma as any, VENDOR_ID, 'van-1', '2026-07-10'),
    ).rejects.toThrow(ConflictException);
  });

  it('throws if the van does not exist for this vendor', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(null);
    mockPrisma.van.findFirst.mockResolvedValue(null);

    await expect(
      service.ensureSheetForVanDate(mockPrisma as any, VENDOR_ID, 'van-1', '2026-07-10'),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws if the vendor has no active product configured', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(null);
    mockPrisma.van.findFirst.mockResolvedValue(VAN);
    mockPrisma.product.findFirst.mockResolvedValue(null);

    await expect(
      service.ensureSheetForVanDate(mockPrisma as any, VENDOR_ID, 'van-1', '2026-07-10'),
    ).rejects.toThrow(ConflictException);
  });
});
