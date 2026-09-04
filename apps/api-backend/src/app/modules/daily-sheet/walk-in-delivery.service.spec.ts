import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { DeliveryStatus } from '@prisma/client';
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
 * Unit tests: DailySheetService.recordWalkInDelivery — Walk-in / Self-Pickup
 * Delivery (docs/features/walk-in-delivery.md).
 *
 * Finds-or-creates a per-vendor sentinel van + user, finds-or-creates the
 * synthetic per-vendor-per-date WALK_IN sheet, appends one DailySheetItem
 * (deliveryType ON_DEMAND + deliveryChannel), upserts the bottle wallet, and
 * routes the money through the existing ledger.recordDelivery(). Back-dated
 * entries anchor the ledger + timeline to the delivery's own date via
 * isCorrection (mirrors addCorrectionItem).
 */
describe('DailySheetService.recordWalkInDelivery', () => {
  let service: DailySheetService;
  let mockPrisma: any;
  let mockLedger: any;
  let mockAudit: any;
  let mockCache: any;

  const VENDOR_ID = 'vendor-001';
  const CUSTOMER_ID = 'customer-001';
  const PRODUCT_ID = 'product-001';
  const SHEET_ID = 'walkin-sheet-001';
  const VAN_ID = 'walkin-van-001';
  const SENTINEL_USER_ID = 'walkin-user-001';

  const USER: AuthUser = {
    userId: 'admin-1',
    email: 'a@example.com',
    name: 'Admin',
    role: 'VENDOR_ADMIN' as AuthUser['role'],
    vendorId: VENDOR_ID,
    customerId: null,
  };

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const baseDto = {
    customerId: CUSTOMER_ID,
    productId: PRODUCT_ID,
    filledDropped: 2,
    emptyReceived: 1,
    filledReceived: 0,
    cashCollected: 0,
    date: today(),
    deliveryChannel: 'SELF_PICKUP',
  } as any;

  function wireTx(existingSheet: any = null) {
    const tx = {
      dailySheet: {
        findUnique: jest.fn().mockResolvedValue(existingSheet),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: SHEET_ID, isClosed: false, ...data }),
        ),
      },
      dailySheetItem: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'item-001', ...data }),
        ),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'item-001', ...data }),
        ),
      },
      bottleWallet: {
        upsert: jest.fn().mockResolvedValue({ balance: 0 }),
        findUnique: jest.fn().mockResolvedValue({ balance: 1 }),
      },
      customer: { findUnique: jest.fn().mockResolvedValue({ financialBalance: 200 }) },
    };
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
    return tx;
  }

  beforeEach(async () => {
    mockLedger = { recordDelivery: jest.fn().mockResolvedValue({ success: true }) };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockCache = {
      invalidateDailyDashboard: jest.fn().mockResolvedValue(undefined),
      invalidateOverview: jest.fn().mockResolvedValue(undefined),
      invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
      invalidateCustomerWallets: jest.fn().mockResolvedValue(undefined),
    };
    mockPrisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({
          id: CUSTOMER_ID,
          name: 'Ahmed',
          customerCode: 'L0001',
          phoneNumber: null,
          paymentType: 'CASH',
          isBillingExempt: false,
          customPrices: [{ productId: PRODUCT_ID, customPrice: 120 }],
        }),
      },
      product: {
        findFirst: jest.fn().mockResolvedValue({ id: PRODUCT_ID, name: '19L Bottle', basePrice: 100 }),
      },
      van: {
        findFirst: jest.fn().mockResolvedValue({ id: VAN_ID }),
        upsert: jest.fn().mockResolvedValue({ id: VAN_ID }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: SENTINEL_USER_ID }),
        create: jest.fn().mockResolvedValue({ id: SENTINEL_USER_ID }),
      },
      vendor: { findUnique: jest.fn().mockResolvedValue({ name: 'Dasani' }) },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailySheetService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: mockLedger },
        { provide: AuditService, useValue: mockAudit },
        { provide: FcmService, useValue: {} },
        { provide: DeliveryIssueService, useValue: {} },
        { provide: CacheInvalidationService, useValue: mockCache },
        { provide: NotificationService, useValue: { queueWhatsAppPdf: jest.fn() } },
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
    (service as any).ledger = mockLedger;
    (service as any).audit = mockAudit;
    (service as any).cache = mockCache;
  });

  afterEach(() => jest.clearAllMocks());

  it('rejects a future date', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 3);
    await expect(
      service.recordWalkInDelivery(USER, { ...baseDto, date: future.toISOString().slice(0, 10) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an entry with no bottle movement', async () => {
    await expect(
      service.recordWalkInDelivery(USER, {
        ...baseDto,
        filledDropped: 0,
        emptyReceived: 0,
        filledReceived: 0,
        cashCollected: 500,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s when the customer is not in the vendor', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null);
    await expect(service.recordWalkInDelivery(USER, baseDto)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('same-day: creates the item COMPLETED, uses the customer rate, upserts the wallet, posts the ledger with no occurredAt', async () => {
    const tx = wireTx();

    await service.recordWalkInDelivery(USER, baseDto);

    // Walk-in sheet found-or-created for the sentinel van.
    expect(tx.dailySheet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'WALK_IN', crewConfirmed: true, vanId: VAN_ID }),
      }),
    );

    // Item: ON_DEMAND + channel + COMPLETED + the customer's custom price (120), no isCorrection.
    const itemData = tx.dailySheetItem.create.mock.calls[0][0].data;
    expect(itemData).toEqual(
      expect.objectContaining({
        deliveryType: 'ON_DEMAND',
        deliveryChannel: 'SELF_PICKUP',
        status: DeliveryStatus.COMPLETED,
        pricePerBottle: 120,
        filledDropped: 2,
        emptyReceived: 1,
      }),
    );
    expect(itemData.isCorrection).toBeUndefined();

    // Wallet upserted before the ledger call.
    expect(tx.bottleWallet.upsert).toHaveBeenCalledTimes(1);

    // Ledger: same-day → no occurredAt, tx client passed.
    const [ledgerArg, txArg] = mockLedger.recordDelivery.mock.calls[0];
    expect(ledgerArg).toEqual(
      expect.objectContaining({
        vendorId: VENDOR_ID,
        dailySheetId: SHEET_ID,
        dailySheetItemId: 'item-001',
        pricePerBottle: 120,
      }),
    );
    expect(ledgerArg.occurredAt).toBeUndefined();
    expect(txArg).toBe(tx);

    // Snapshots stamped + caches fanned out.
    expect(tx.dailySheetItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bottleBalanceAfter: 1, financialBalanceAfter: 200 }),
      }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WALK_IN_DELIVERY_ADDED' }),
    );
    expect(mockCache.invalidateCustomerWallets).toHaveBeenCalledWith(VENDOR_ID, CUSTOMER_ID);
  });

  it('flips to EMPTY_ONLY when nothing was dropped', async () => {
    const tx = wireTx();
    await service.recordWalkInDelivery(USER, {
      ...baseDto,
      filledDropped: 0,
      emptyReceived: 3,
    });
    expect(tx.dailySheetItem.create.mock.calls[0][0].data.status).toBe(DeliveryStatus.EMPTY_ONLY);
  });

  it('back-dated: sets isCorrection + anchors the ledger to the delivery date', async () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    const pastStr = past.toISOString().slice(0, 10);
    const tx = wireTx();

    await service.recordWalkInDelivery(USER, { ...baseDto, date: pastStr });

    const itemData = tx.dailySheetItem.create.mock.calls[0][0].data;
    expect(itemData.isCorrection).toBe(true);
    expect(itemData.correctionNote).toBeTruthy();

    const [ledgerArg] = mockLedger.recordDelivery.mock.calls[0];
    expect(ledgerArg.occurredAt).toBeInstanceOf(Date);
  });

  it('reuses an existing walk-in sheet for the same date instead of creating one', async () => {
    const tx = wireTx({ id: SHEET_ID, isClosed: false, date: new Date() });
    await service.recordWalkInDelivery(USER, baseDto);
    expect(tx.dailySheet.create).not.toHaveBeenCalled();
    expect(mockLedger.recordDelivery.mock.calls[0][0].dailySheetId).toBe(SHEET_ID);
  });
});
