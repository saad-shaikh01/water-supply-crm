import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, ConflictException } from '@nestjs/common';
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
 * Unit tests: the Void Delivery immutability guards on the other
 * DailySheetItem entrypoints.
 *
 *  - submitDelivery rejects a VOIDED item (assertItemNotVoided, before any
 *    ledger work), rejects dto.status === 'VOIDED' (VOIDED is not a
 *    submittable outcome), and rejects any submit onto a closed sheet.
 *  - unlockDeliveryEdit / requestDeliveryEdit reject a VOIDED item.
 */
describe('DailySheetService — Void Delivery guards', () => {
  let service: DailySheetService;
  let mockPrisma: any;

  const VENDOR_ID = 'vendor-001';
  const ITEM_ID = 'item-001';
  const DRIVER_ID = 'driver-001';
  const SHEET_DATE = new Date('2026-08-17T00:00:00.000Z');

  const STAFF_USER: AuthUser = {
    userId: 'staff-1',
    email: 's@example.com',
    name: 'Staff',
    role: 'STAFF' as AuthUser['role'],
    vendorId: VENDOR_ID,
    customerId: null,
  };
  const DRIVER_USER: AuthUser = {
    userId: DRIVER_ID,
    email: 'd@example.com',
    name: 'Driver',
    role: 'DRIVER' as AuthUser['role'],
    vendorId: VENDOR_ID,
    customerId: null,
  };

  const baseCustomer = {
    name: 'C',
    customerCode: 'C001',
    phoneNumber: null,
    paymentType: 'CASH',
    isBillingExempt: false,
    financialBalance: 0,
    customPrices: [],
  };

  beforeEach(async () => {
    mockPrisma = {
      dailySheetItem: { findUnique: jest.fn(), update: jest.fn() },
      conversationMessage: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailySheetService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: { recordDelivery: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn() } },
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

  afterEach(() => jest.clearAllMocks());

  // ── submitDelivery ────────────────────────────────────────────────────────
  describe('submitDelivery', () => {
    it('rejects a VOIDED item with ConflictException before any ledger work', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue({
        id: ITEM_ID,
        status: DeliveryStatus.VOIDED,
        voidedAt: new Date(),
        customer: baseCustomer,
        product: { name: 'Bottle', basePrice: 100 },
        dailySheet: { vendorId: VENDOR_ID, date: SHEET_DATE, isClosed: false, vendor: { name: 'V' }, van: { plateNumber: 'V1' } },
      });

      await expect(
        service.submitDelivery(STAFF_USER, ITEM_ID, {
          status: DeliveryStatus.COMPLETED,
          filledDropped: 1,
          emptyReceived: 0,
          filledReceived: 0,
          cashCollected: 0,
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.conversationMessage.count).not.toHaveBeenCalled();
    });

    it('rejects dto.status === "VOIDED" with BadRequestException', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue({
        id: ITEM_ID,
        status: DeliveryStatus.PENDING,
        voidedAt: null,
        customer: baseCustomer,
        product: { name: 'Bottle', basePrice: 100 },
        dailySheet: { vendorId: VENDOR_ID, date: SHEET_DATE, isClosed: false, vendor: { name: 'V' }, van: { plateNumber: 'V1' } },
      });

      await expect(
        service.submitDelivery(STAFF_USER, ITEM_ID, {
          status: 'VOIDED',
          filledDropped: 0,
          emptyReceived: 0,
          filledReceived: 0,
          cashCollected: 0,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects any submit onto a closed sheet with ConflictException', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue({
        id: ITEM_ID,
        status: DeliveryStatus.PENDING,
        voidedAt: null,
        customer: baseCustomer,
        product: { name: 'Bottle', basePrice: 100 },
        dailySheet: { vendorId: VENDOR_ID, date: SHEET_DATE, isClosed: true, vendor: { name: 'V' }, van: { plateNumber: 'V1' } },
      });

      await expect(
        service.submitDelivery(STAFF_USER, ITEM_ID, {
          status: DeliveryStatus.COMPLETED,
          filledDropped: 1,
          emptyReceived: 0,
          filledReceived: 0,
          cashCollected: 0,
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ── unlockDeliveryEdit ────────────────────────────────────────────────────
  it('unlockDeliveryEdit rejects a VOIDED item with ConflictException', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue({
      id: ITEM_ID,
      status: DeliveryStatus.VOIDED,
      voidedAt: new Date(),
      dailySheet: { vendorId: VENDOR_ID },
    });

    await expect(
      service.unlockDeliveryEdit(STAFF_USER, ITEM_ID, {} as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.dailySheetItem.update).not.toHaveBeenCalled();
  });

  // ── requestDeliveryEdit ───────────────────────────────────────────────────
  it('requestDeliveryEdit rejects a VOIDED item with ConflictException', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue({
      id: ITEM_ID,
      status: DeliveryStatus.VOIDED,
      voidedAt: new Date(),
      dailySheet: { id: 'sheet-001', vendorId: VENDOR_ID, driverId: DRIVER_ID, date: SHEET_DATE },
      customer: { name: 'C' },
    });

    await expect(
      service.requestDeliveryEdit(DRIVER_USER, ITEM_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.dailySheetItem.update).not.toHaveBeenCalled();
  });
});
