import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
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
 * Unit tests: DailySheetService.correctClosedDelivery — Edit Closed-Sheet Delivery.
 *
 * Dedicated endpoint (PATCH /daily-sheets/items/:id/correct) that amends the
 * figures of an already-recorded COMPLETED / EMPTY_ONLY delivery on a CLOSED
 * sheet, keeping it a single row. The balance/wallet adjustment is entirely
 * ledger.recordDelivery() on an item that already has ledger rows (signed
 * delta). Row-locks the item first, re-asserts correctability in-txn, maps the
 * ledger's negative-wallet BadRequest to a 422, writes a
 * CLOSED_DELIVERY_CORRECTED audit row, fans out the 3-way cache invalidation,
 * and deliberately does NOT touch cashExpected / buildReconciliation.
 */
describe('DailySheetService.correctClosedDelivery', () => {
  let service: DailySheetService;
  let mockPrisma: any;
  let mockLedger: any;
  let mockAudit: any;
  let mockCache: any;

  const VENDOR_ID = 'vendor-001';
  const OTHER_VENDOR = 'vendor-999';
  const ITEM_ID = 'item-001';
  const CUSTOMER_ID = 'customer-001';
  const PRODUCT_ID = 'product-001';
  const SHEET_ID = 'sheet-001';
  const SHEET_DATE = new Date('2026-08-17T00:00:00.000Z');

  const ADMIN_USER: AuthUser = {
    userId: 'admin-1',
    email: 'a@example.com',
    name: 'Admin',
    role: 'VENDOR_ADMIN' as AuthUser['role'],
    vendorId: VENDOR_ID,
    customerId: null,
  };

  const dto = {
    filledDropped: 6,
    emptyReceived: 4,
    filledReceived: 0,
    cashCollected: 600,
    correctionNote: 'driver logged 5/500, actually 6/600',
  } as any;

  function buildItem(overrides: Record<string, unknown> = {}) {
    return {
      id: ITEM_ID,
      status: DeliveryStatus.COMPLETED,
      voidedAt: null,
      isCorrection: false,
      customerId: CUSTOMER_ID,
      productId: PRODUCT_ID,
      dailySheetId: SHEET_ID,
      filledDropped: 5,
      emptyReceived: 3,
      filledReceived: 0,
      cashCollected: 500,
      pricePerBottle: 100,
      dailySheet: { vendorId: VENDOR_ID, isClosed: true, date: SHEET_DATE },
      customer: { id: CUSTOMER_ID, isBillingExempt: false },
      product: { id: PRODUCT_ID },
      ...overrides,
    };
  }

  function wireTx(
    opts: { freshStatus?: DeliveryStatus; freshVoidedAt?: Date | null } = {},
  ) {
    const { freshStatus = DeliveryStatus.COMPLETED, freshVoidedAt = null } = opts;
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      dailySheetItem: {
        findUnique: jest.fn().mockResolvedValue({ status: freshStatus, voidedAt: freshVoidedAt }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: ITEM_ID, ...data })),
      },
      bottleWallet: { findUnique: jest.fn().mockResolvedValue({ balance: 12 }) },
      customer: { findUnique: jest.fn().mockResolvedValue({ financialBalance: 250 }) },
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
    };
    mockPrisma = {
      dailySheetItem: { findUnique: jest.fn() },
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
    (service as any).ledger = mockLedger;
    (service as any).audit = mockAudit;
    (service as any).cache = mockCache;
  });

  afterEach(() => jest.clearAllMocks());

  // ── Happy path ────────────────────────────────────────────────────────────
  it('locks the row, deltas the ledger with the new figures, updates the item, audits, invalidates caches', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
    const tx = wireTx();

    await service.correctClosedDelivery(ADMIN_USER, ITEM_ID, dto);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

    // Row lock: SELECT … FOR UPDATE first, loadId bound as a param, before the re-read.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [rawStrings, ...rawValues] = tx.$queryRaw.mock.calls[0];
    expect((rawStrings as string[]).join('?')).toMatch(/FOR UPDATE/i);
    expect((rawStrings as string[]).join('?')).toMatch(/"DailySheetItem"/);
    expect(rawValues).toEqual([ITEM_ID]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.dailySheetItem.findUnique.mock.invocationCallOrder[0],
    );

    // Ledger delta: new figures + kept price + occurredAt = sheet.date, tx client.
    expect(mockLedger.recordDelivery).toHaveBeenCalledTimes(1);
    const [ledgerArg, txArg] = mockLedger.recordDelivery.mock.calls[0];
    expect(ledgerArg).toEqual(
      expect.objectContaining({
        vendorId: VENDOR_ID,
        customerId: CUSTOMER_ID,
        productId: PRODUCT_ID,
        dailySheetId: SHEET_ID,
        dailySheetItemId: ITEM_ID,
        filledDropped: 6,
        emptyReceived: 4,
        filledReceived: 0,
        cashCollected: 600,
        pricePerBottle: 100,
        occurredAt: SHEET_DATE,
      }),
    );
    expect(txArg).toBe(tx);

    // Item update: figures + kept price + status stays COMPLETED + isCorrection
    // + editCount increment + snapshots from the in-txn wallet/customer reads.
    expect(tx.dailySheetItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ITEM_ID },
        data: expect.objectContaining({
          filledDropped: 6,
          emptyReceived: 4,
          filledReceived: 0,
          cashCollected: 600,
          pricePerBottle: 100,
          status: DeliveryStatus.COMPLETED,
          isCorrection: true,
          correctionNote: dto.correctionNote,
          editCount: { increment: 1 },
          bottleBalanceAfter: 12,
          financialBalanceAfter: 250,
        }),
      }),
    );
    expect(tx.dailySheetItem.update.mock.calls[0][0].data.lastEditedAt).toBeInstanceOf(Date);
    expect(tx.dailySheetItem.update.mock.calls[0][0].data.correctionAddedAt).toBeInstanceOf(Date);

    // Audit CLOSED_DELIVERY_CORRECTED with before/after figures + note.
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: VENDOR_ID,
        userId: ADMIN_USER.userId,
        action: 'CLOSED_DELIVERY_CORRECTED',
        entity: 'DailySheetItem',
        entityId: ITEM_ID,
        changes: {
          before: expect.objectContaining({ filledDropped: 5, cashCollected: 500, pricePerBottle: 100 }),
          after: expect.objectContaining({ filledDropped: 6, cashCollected: 600, correctionNote: dto.correctionNote }),
        },
      }),
    );

    // 3-way cache invalidation.
    expect(mockCache.invalidateDailyDashboard).toHaveBeenCalledWith(VENDOR_ID, '2026-08-17');
    expect(mockCache.invalidateOverview).toHaveBeenCalledWith(VENDOR_ID);
    expect(mockCache.invalidateAnalytics).toHaveBeenCalledWith(VENDOR_ID);
  });

  // ── priceOverride ────────────────────────────────────────────────────────
  it('priceOverride is forwarded to both the ledger and the item update', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
    const tx = wireTx();

    await service.correctClosedDelivery(ADMIN_USER, ITEM_ID, { ...dto, priceOverride: 130 });

    expect(mockLedger.recordDelivery.mock.calls[0][0].pricePerBottle).toBe(130);
    expect(tx.dailySheetItem.update.mock.calls[0][0].data.pricePerBottle).toBe(130);
  });

  // ── EMPTY_ONLY status flip ───────────────────────────────────────────────
  it('correcting filledDropped to 0 flips the item to EMPTY_ONLY', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
    const tx = wireTx();

    await service.correctClosedDelivery(ADMIN_USER, ITEM_ID, { ...dto, filledDropped: 0 });

    expect(tx.dailySheetItem.update.mock.calls[0][0].data.status).toBe(DeliveryStatus.EMPTY_ONLY);
  });

  it('correcting an EMPTY_ONLY item back to >0 filled flips it to COMPLETED', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem({ status: DeliveryStatus.EMPTY_ONLY }));
    const tx = wireTx({ freshStatus: DeliveryStatus.EMPTY_ONLY });

    await service.correctClosedDelivery(ADMIN_USER, ITEM_ID, { ...dto, filledDropped: 6 });

    expect(tx.dailySheetItem.update.mock.calls[0][0].data.status).toBe(DeliveryStatus.COMPLETED);
  });

  // ── No reconciliation side effects ──────────────────────────────────────
  it('does NOT re-run reconciliation and never writes cashExpected', async () => {
    const reconSpy = jest.spyOn(service as any, 'buildReconciliation');
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
    const tx = wireTx();

    await service.correctClosedDelivery(ADMIN_USER, ITEM_ID, dto);

    expect(reconSpy).not.toHaveBeenCalled();
    for (const call of tx.dailySheetItem.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('cashExpected');
    }
  });

  // ── Rejections ──────────────────────────────────────────────────────────
  it('sheet not closed → ConflictException, nothing mutated', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildItem({ dailySheet: { vendorId: VENDOR_ID, isClosed: false, date: SHEET_DATE } }),
    );

    await expect(service.correctClosedDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockAudit.log).not.toHaveBeenCalled();
  });

  it('VOIDED item → ConflictException', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildItem({ status: DeliveryStatus.VOIDED }),
    );

    await expect(service.correctClosedDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('PENDING item → BadRequestException', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildItem({ status: DeliveryStatus.PENDING }),
    );

    await expect(service.correctClosedDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('wrong-tenant item → NotFoundException', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildItem({ dailySheet: { vendorId: OTHER_VENDOR, isClosed: true, date: SHEET_DATE } }),
    );

    await expect(service.correctClosedDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('missing item → NotFoundException', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(null);
    await expect(service.correctClosedDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('in-txn re-read shows the item was voided by a concurrent txn → ConflictException, no ledger touch', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
    wireTx({ freshStatus: DeliveryStatus.VOIDED, freshVoidedAt: new Date() });

    await expect(service.correctClosedDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mockLedger.recordDelivery).not.toHaveBeenCalled();
  });

  // ── Negative-wallet 422 mapping ─────────────────────────────────────────
  it('ledger negative-wallet BadRequest → UnprocessableEntity CLOSED_DELIVERY_CORRECTION_WALLET_NEGATIVE', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
    wireTx();
    mockLedger.recordDelivery.mockRejectedValue(
      new BadRequestException('Editing this delivery would make the bottle wallet negative (current: 2, delta: -5).'),
    );

    await expect(service.correctClosedDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(service.correctClosedDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CLOSED_DELIVERY_CORRECTION_WALLET_NEGATIVE' }),
    });
    expect(mockAudit.log).not.toHaveBeenCalled();
  });

  it('a non-negative BadRequest from the ledger is NOT swallowed as 422', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
    wireTx();
    mockLedger.recordDelivery.mockRejectedValue(new BadRequestException('some other ledger failure'));

    await expect(service.correctClosedDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.correctClosedDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.not.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});
