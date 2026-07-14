import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
import { CollectionPolicyService } from '../collection-policy/collection-policy.service';
import type { AuthUser } from '@water-supply-crm/types';
import type { MoveDeliveryItemsDto } from './dto/move-delivery-items.dto';

/**
 * Unit tests for DailySheetService.moveDeliveryItems — the Customer
 * Swap/Move feature. Mechanism is in-place mutation of the existing
 * DailySheetItem row (dailySheetId/sequence/status), not copy-and-cancel;
 * see the approved plan for why (analytics.service.ts counts CANCELLED as
 * a missed delivery, which a cancelled-source-item design would have
 * permanently miscounted for moved customers).
 */
function buildMockAudit() {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

function buildMockTx() {
  return {
    dailySheet: { findFirst: jest.fn(), create: jest.fn() },
    dailySheetItem: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 0 } }),
      update: jest.fn(),
    },
    customerOrder: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    van: { findFirst: jest.fn() },
    product: { findFirst: jest.fn() },
  };
}

async function buildService(mockAudit: ReturnType<typeof buildMockAudit>) {
  const mockPrisma: any = {
    dailySheetItem: { findMany: jest.fn() },
    van: { findFirst: jest.fn() },
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DailySheetService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: LedgerService, useValue: {} },
      { provide: AuditService, useValue: mockAudit },
      { provide: FcmService, useValue: {} },
      { provide: DeliveryIssueService, useValue: {} },
      { provide: CacheInvalidationService, useValue: {} },
      { provide: NotificationService, useValue: {} },
      { provide: InAppNotificationService, useValue: {} },
      { provide: StorageService, useValue: {} },
      { provide: WarehouseService, useValue: {} },
      { provide: DeliveryReceiptPdfService, useValue: {} },
      { provide: NotificationSettingsService, useValue: {} },
      { provide: CollectionPolicyService, useValue: {} },
      {
        provide: getQueueToken(QUEUE_NAMES.DAILY_SHEET_GENERATION),
        useValue: { add: jest.fn(), getJob: jest.fn(), getRepeatableJobs: jest.fn().mockResolvedValue([]), upsertJobScheduler: jest.fn() },
      },
    ],
  }).compile();

  const service = module.get<DailySheetService>(DailySheetService);
  (service as any).prisma = mockPrisma;
  (service as any).audit = mockAudit;
  return { service, mockPrisma };
}

const USER: AuthUser = {
  userId: 'user-1',
  email: 'staff@vendor.test',
  name: 'Staff Member',
  role: 'STAFF',
  vendorId: 'vendor-1',
  customerId: null,
};

const SOURCE_SHEET = { id: 'sheet-source', vendorId: 'vendor-1', vanId: 'van-source', date: new Date('2026-07-10'), isClosed: false };

function pendingItem(overrides: Partial<any> = {}) {
  return {
    id: 'item-1',
    dailySheetId: 'sheet-source',
    customerId: 'cust-a',
    productId: 'product-1',
    sequence: 3,
    status: 'PENDING',
    dailySheet: SOURCE_SHEET,
    customer: { id: 'cust-a', name: 'Alice' },
    ...overrides,
  };
}

const BASE_DTO: MoveDeliveryItemsDto = {
  itemIds: ['item-1'],
  destinationVanId: 'van-dest',
  destinationDate: '2099-01-01', // always "future" regardless of when tests run
};

describe('DailySheetService.moveDeliveryItems', () => {
  let service: DailySheetService;
  let mockPrisma: any;
  let mockAudit: ReturnType<typeof buildMockAudit>;

  beforeEach(async () => {
    mockAudit = buildMockAudit();
    ({ service, mockPrisma } = await buildService(mockAudit));
  });

  afterEach(() => jest.clearAllMocks());

  it('rejects if any item is not found', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([]); // dto asked for 1 item, got 0
    await expect(service.moveDeliveryItems(USER, BASE_DTO)).rejects.toThrow(NotFoundException);
  });

  it('rejects cross-vendor items (tenant isolation)', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([
      pendingItem({ dailySheet: { ...SOURCE_SHEET, vendorId: 'other-vendor' } }),
    ]);
    await expect(service.moveDeliveryItems(USER, BASE_DTO)).rejects.toThrow(NotFoundException);
  });

  it('rejects moving a COMPLETED item', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([pendingItem({ status: 'COMPLETED' })]);
    await expect(service.moveDeliveryItems(USER, BASE_DTO)).rejects.toThrow(ConflictException);
  });

  it('rejects a past destination date', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([pendingItem()]);
    await expect(
      service.moveDeliveryItems(USER, { ...BASE_DTO, destinationDate: '2020-01-01' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an unknown/inactive destination van', async () => {
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([pendingItem()]);
    mockPrisma.van.findFirst.mockResolvedValue(null);
    await expect(service.moveDeliveryItems(USER, BASE_DTO)).rejects.toThrow(NotFoundException);
  });

  it('rejects moving to the same van+date the item is already on', async () => {
    const sameDayDto: MoveDeliveryItemsDto = { ...BASE_DTO, destinationVanId: 'van-source', destinationDate: '2026-07-10' };
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([pendingItem()]);
    mockPrisma.van.findFirst.mockResolvedValue({ id: 'van-source', isActive: true });
    await expect(service.moveDeliveryItems(USER, sameDayDto)).rejects.toThrow(ConflictException);
  });

  describe('once past outer validation (mocked $transaction)', () => {
    let tx: ReturnType<typeof buildMockTx>;

    beforeEach(() => {
      mockPrisma.dailySheetItem.findMany.mockResolvedValue([pendingItem()]);
      mockPrisma.van.findFirst.mockResolvedValue({ id: 'van-dest', isActive: true });
      tx = buildMockTx();
      mockPrisma.$transaction = jest.fn().mockImplementation((fn: (tx: any) => unknown) => fn(tx));
    });

    it('moves onto an existing open destination sheet in place (no new item created)', async () => {
      tx.dailySheet.findFirst.mockResolvedValue({ id: 'sheet-dest', isClosed: false });
      tx.dailySheetItem.findMany.mockResolvedValue([]); // no duplicate customer on destination
      tx.dailySheetItem.aggregate.mockResolvedValue({ _max: { sequence: 5 } });
      tx.dailySheetItem.update.mockResolvedValue({ id: 'item-1', sequence: 6, status: 'PENDING' });

      const result = await service.moveDeliveryItems(USER, BASE_DTO);

      expect(tx.dailySheet.create).not.toHaveBeenCalled();
      expect(tx.dailySheetItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { dailySheetId: 'sheet-dest', sequence: 6, status: 'PENDING' },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CUSTOMER_DELIVERY_MOVED', entity: 'DailySheetItem', entityId: 'item-1' }),
      );
      expect(result).toEqual({ destinationSheetId: 'sheet-dest', createdNewSheet: false, movedCount: 1 });
    });

    it('auto-creates the destination sheet when none exists for that van+date', async () => {
      tx.dailySheet.findFirst.mockResolvedValue(null); // ensureSheetForVanDate: no existing sheet
      tx.van.findFirst.mockResolvedValue({
        id: 'van-dest',
        defaultDriverId: 'driver-dest',
        routes: [],
        defaultCrew: [],
        deliverySchedules: [],
      });
      tx.product.findFirst.mockResolvedValue({ id: 'product-1' });
      tx.dailySheet.create.mockResolvedValue({ id: 'sheet-new', isClosed: false });
      tx.dailySheetItem.update.mockResolvedValue({ id: 'item-1', sequence: 1, status: 'PENDING' });

      const result = await service.moveDeliveryItems(USER, BASE_DTO);

      expect(tx.dailySheet.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ destinationSheetId: 'sheet-new', createdNewSheet: true, movedCount: 1 });
    });

    it('rejects when the destination van has no default driver and a sheet must be created', async () => {
      tx.dailySheet.findFirst.mockResolvedValue(null);
      tx.van.findFirst.mockResolvedValue({
        id: 'van-dest',
        defaultDriverId: null,
        routes: [],
        defaultCrew: [],
        deliverySchedules: [],
      });

      await expect(service.moveDeliveryItems(USER, BASE_DTO)).rejects.toThrow(ConflictException);
    });

    it('rejects moving onto a closed destination sheet', async () => {
      tx.dailySheet.findFirst.mockResolvedValue({ id: 'sheet-dest', isClosed: true });
      await expect(service.moveDeliveryItems(USER, BASE_DTO)).rejects.toThrow(ConflictException);
    });

    it('rejects when the customer already has an active item on the destination sheet', async () => {
      tx.dailySheet.findFirst.mockResolvedValue({ id: 'sheet-dest', isClosed: false });
      tx.dailySheetItem.findMany.mockResolvedValue([
        { customerId: 'cust-a', customer: { name: 'Alice' } },
      ]);
      await expect(service.moveDeliveryItems(USER, BASE_DTO)).rejects.toThrow(ConflictException);
    });

    it('recovers from a concurrent-create race (P2002) by re-fetching the sheet the other request created', async () => {
      // First lookup inside ensureSheetForVanDate: not found -> attempts create.
      tx.dailySheet.findFirst
        .mockResolvedValueOnce(null) // ensureSheetForVanDate's own check
        .mockResolvedValueOnce({ id: 'sheet-dest-from-other-tx', isClosed: false }); // post-P2002 re-fetch
      tx.van.findFirst.mockResolvedValue({
        id: 'van-dest',
        defaultDriverId: 'driver-dest',
        routes: [],
        defaultCrew: [],
        deliverySchedules: [],
      });
      tx.product.findFirst.mockResolvedValue({ id: 'product-1' });
      tx.dailySheet.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      tx.dailySheetItem.update.mockResolvedValue({ id: 'item-1', sequence: 1, status: 'PENDING' });

      const result = await service.moveDeliveryItems(USER, BASE_DTO);

      expect(result.destinationSheetId).toBe('sheet-dest-from-other-tx');
      expect(result.createdNewSheet).toBe(false);
    });
  });
});
