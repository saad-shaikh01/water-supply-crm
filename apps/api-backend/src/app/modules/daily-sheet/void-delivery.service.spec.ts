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
import { DeliveryStatus, DeliveryVoidReason } from '@prisma/client';
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
 * Unit tests: DailySheetService.voidDelivery — the Void Delivery feature.
 *
 * Void strikes a recorded stop from the operational record (append-only —
 * status flips to VOIDED, metadata stamped, an AuditLog DELIVERY_VOIDED row
 * written). For a pre-void status of COMPLETED / EMPTY_ONLY the ledger effect
 * is reversed through the existing idempotent all-zero repost; for
 * NOT_AVAILABLE / RESCHEDULED / CANCELLED it is an audit-only operational hide.
 * PENDING is not voidable. Allowed on a closed sheet (analogous to Correction
 * Entry); the reversing ledger rows are then dated to the sheet's date.
 */
describe('DailySheetService.voidDelivery', () => {
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

  function buildItem(overrides: Record<string, unknown> = {}) {
    return {
      id: ITEM_ID,
      status: DeliveryStatus.COMPLETED,
      voidedAt: null,
      isCorrection: false,
      customerId: CUSTOMER_ID,
      productId: PRODUCT_ID,
      dailySheetId: SHEET_ID,
      filledDropped: 2,
      emptyReceived: 1,
      filledReceived: 0,
      cashCollected: 150,
      pricePerBottle: 100,
      dailySheet: { vendorId: VENDOR_ID, isClosed: false, date: SHEET_DATE },
      customer: { id: CUSTOMER_ID },
      product: { id: PRODUCT_ID },
      ...overrides,
    };
  }

  /**
   * Wires $transaction to invoke its callback with a tx mock and returns it.
   *
   * The void write is now an atomic conditional claim: `updateMany` flips the
   * row to VOIDED only while `voidedAt: null` — `claimCount` is what it matched
   * (1 = this caller won the race, 0 = someone else already voided it).
   * `ledgerRowCount` is what `tx.transaction.count` returns for the DELIVERY
   * row (0 = legacy/unlinked item, ledger reversal is skipped).
   */
  function wireTx(opts: { claimCount?: number; ledgerRowCount?: number } = {}) {
    const { claimCount = 1, ledgerRowCount = 1 } = opts;
    const tx = {
      dailySheetItem: {
        updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
        findUnique: jest.fn().mockResolvedValue({
          id: ITEM_ID,
          status: DeliveryStatus.VOIDED,
          pricePerBottle: 100,
        }),
      },
      transaction: {
        count: jest.fn().mockResolvedValue(ledgerRowCount),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
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

  const dto = { voidReason: DeliveryVoidReason.DATA_ENTRY_ERROR } as any;

  // ── Happy path: COMPLETED ──────────────────────────────────────────────────
  describe('COMPLETED (ledger reversal)', () => {
    it('reverses the ledger, flips status to VOIDED, audits and invalidates caches', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
      const tx = wireTx();

      await service.voidDelivery(ADMIN_USER, ITEM_ID, dto);

      // Single $transaction
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

      // Ledger reversal: all-zero quantities/cash + the item's pricePerBottle,
      // keyed to the item, passed the tx client.
      expect(mockLedger.recordDelivery).toHaveBeenCalledTimes(1);
      const [ledgerArg, txArg] = mockLedger.recordDelivery.mock.calls[0];
      expect(ledgerArg).toEqual(
        expect.objectContaining({
          vendorId: VENDOR_ID,
          customerId: CUSTOMER_ID,
          productId: PRODUCT_ID,
          dailySheetId: SHEET_ID,
          dailySheetItemId: ITEM_ID,
          filledDropped: 0,
          emptyReceived: 0,
          filledReceived: 0,
          cashCollected: 0,
          pricePerBottle: 100,
        }),
      );
      expect(txArg).toBe(tx);

      // Leftover zero DELIVERY row dropped.
      expect(tx.transaction.deleteMany).toHaveBeenCalledWith({
        where: { dailySheetItemId: ITEM_ID, type: 'DELIVERY' },
      });

      // Item flipped to VOIDED via an atomic conditional claim — the WHERE
      // guards on the row still being un-voided, and the void metadata is
      // written in the same statement.
      expect(tx.dailySheetItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ITEM_ID, voidedAt: null, status: { not: DeliveryStatus.VOIDED } },
          data: expect.objectContaining({
            status: DeliveryStatus.VOIDED,
            voidedById: ADMIN_USER.userId,
            voidReason: DeliveryVoidReason.DATA_ENTRY_ERROR,
            voidNote: null,
          }),
        }),
      );
      expect(tx.dailySheetItem.updateMany.mock.calls[0][0].data.voidedAt).toBeInstanceOf(Date);
      // Return value comes from a final re-read of the row.
      expect(tx.dailySheetItem.findUnique).toHaveBeenCalledWith({ where: { id: ITEM_ID } });

      // Audit DELIVERY_VOIDED with before/after shape.
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorId: VENDOR_ID,
          userId: ADMIN_USER.userId,
          action: 'DELIVERY_VOIDED',
          entity: 'DailySheetItem',
          entityId: ITEM_ID,
          changes: {
            before: expect.objectContaining({ status: DeliveryStatus.COMPLETED, cashCollected: 150 }),
            after: expect.objectContaining({ status: 'VOIDED', voidReason: DeliveryVoidReason.DATA_ENTRY_ERROR }),
          },
        }),
      );

      // Cache trio.
      expect(mockCache.invalidateDailyDashboard).toHaveBeenCalledWith(VENDOR_ID, '2026-08-17');
      expect(mockCache.invalidateOverview).toHaveBeenCalledWith(VENDOR_ID);
      expect(mockCache.invalidateAnalytics).toHaveBeenCalledWith(VENDOR_ID);
    });

    it('stores a supplied voidNote', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
      const tx = wireTx();

      await service.voidDelivery(ADMIN_USER, ITEM_ID, {
        voidReason: DeliveryVoidReason.OTHER,
        voidNote: 'manager approved after depot recount',
      } as any);

      expect(tx.dailySheetItem.updateMany.mock.calls[0][0].data.voidNote).toBe(
        'manager approved after depot recount',
      );
    });

    it('open non-correction sheet → ledger reversal carries NO occurredAt (posts now)', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
      wireTx();

      await service.voidDelivery(ADMIN_USER, ITEM_ID, dto);

      const ledgerArg = mockLedger.recordDelivery.mock.calls[0][0];
      expect('occurredAt' in ledgerArg).toBe(false);
    });
  });

  // ── EMPTY_ONLY also reverses ──────────────────────────────────────────────
  it('EMPTY_ONLY → ledger reversal runs', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildItem({ status: DeliveryStatus.EMPTY_ONLY }),
    );
    wireTx();

    await service.voidDelivery(ADMIN_USER, ITEM_ID, dto);

    expect(mockLedger.recordDelivery).toHaveBeenCalledTimes(1);
  });

  // ── Audit-only statuses ──────────────────────────────────────────────────
  describe.each([
    DeliveryStatus.NOT_AVAILABLE,
    DeliveryStatus.RESCHEDULED,
    DeliveryStatus.CANCELLED,
  ])('%s (audit-only, no ledger)', (status) => {
    it('flips to VOIDED and audits without touching the ledger', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem({ status }));
      const tx = wireTx();

      await service.voidDelivery(ADMIN_USER, ITEM_ID, dto);

      expect(mockLedger.recordDelivery).not.toHaveBeenCalled();
      expect(tx.transaction.count).not.toHaveBeenCalled();
      expect(tx.transaction.deleteMany).not.toHaveBeenCalled();
      expect(tx.dailySheetItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: DeliveryStatus.VOIDED }) }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELIVERY_VOIDED' }),
      );
    });
  });

  // ── Rejections ──────────────────────────────────────────────────────────
  it('PENDING → BadRequestException, nothing mutated', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildItem({ status: DeliveryStatus.PENDING }),
    );

    await expect(service.voidDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockLedger.recordDelivery).not.toHaveBeenCalled();
    expect(mockAudit.log).not.toHaveBeenCalled();
  });

  it('already VOIDED (status) → ConflictException', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildItem({ status: DeliveryStatus.VOIDED, voidedAt: new Date() }),
    );
    await expect(service.voidDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('already VOIDED (voidedAt set, stale status) → ConflictException', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildItem({ status: DeliveryStatus.COMPLETED, voidedAt: new Date() }),
    );
    await expect(service.voidDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('wrong-tenant item → NotFoundException', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildItem({ dailySheet: { vendorId: OTHER_VENDOR, isClosed: false, date: SHEET_DATE } }),
    );
    await expect(service.voidDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('missing item → NotFoundException', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(null);
    await expect(service.voidDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // ── occurredAt backdating ───────────────────────────────────────────────
  it('closed sheet → reversal dated to sheet.date, and the void still succeeds', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildItem({ dailySheet: { vendorId: VENDOR_ID, isClosed: true, date: SHEET_DATE } }),
    );
    wireTx();

    await service.voidDelivery(ADMIN_USER, ITEM_ID, dto);

    expect(mockLedger.recordDelivery.mock.calls[0][0].occurredAt).toEqual(SHEET_DATE);
  });

  it('isCorrection item on an OPEN sheet → reversal dated to sheet.date', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildItem({ isCorrection: true, dailySheet: { vendorId: VENDOR_ID, isClosed: false, date: SHEET_DATE } }),
    );
    wireTx();

    await service.voidDelivery(ADMIN_USER, ITEM_ID, dto);

    expect(mockLedger.recordDelivery.mock.calls[0][0].occurredAt).toEqual(SHEET_DATE);
  });

  // ── Negative-wallet 422 mapping ─────────────────────────────────────────
  it('ledger negative-wallet BadRequest → UnprocessableEntity VOID_WOULD_MAKE_WALLET_NEGATIVE', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
    wireTx();
    mockLedger.recordDelivery.mockRejectedValue(
      new BadRequestException(
        'Editing this delivery would make the bottle wallet negative (current: 2, delta: -5).',
      ),
    );

    await expect(service.voidDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VOID_WOULD_MAKE_WALLET_NEGATIVE' }),
    });
    await expect(service.voidDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('a non-negative BadRequest from the ledger is NOT swallowed as 422', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
    wireTx();
    mockLedger.recordDelivery.mockRejectedValue(new BadRequestException('some other ledger failure'));

    await expect(service.voidDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // ── Concurrency ─────────────────────────────────────────────────────────
  it('atomic claim matches 0 rows (already voided by a concurrent txn) → ConflictException, no ledger touch', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
    const tx = wireTx({ claimCount: 0 });

    await expect(service.voidDelivery(ADMIN_USER, ITEM_ID, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // The claim ran, matched nothing; the ledger reversal never starts.
    expect(tx.dailySheetItem.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.transaction.count).not.toHaveBeenCalled();
    expect(mockLedger.recordDelivery).not.toHaveBeenCalled();
    expect(tx.transaction.deleteMany).not.toHaveBeenCalled();
  });

  // ── FIX 5: ledger-bearing status but no DELIVERY txn row ────────────────
  it('COMPLETED with zero DELIVERY txn rows → still voided, no recordDelivery, no deleteMany', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildItem());
    const tx = wireTx({ ledgerRowCount: 0 });

    await service.voidDelivery(ADMIN_USER, ITEM_ID, dto);

    expect(tx.transaction.count).toHaveBeenCalledWith({
      where: { dailySheetItemId: ITEM_ID, type: 'DELIVERY' },
    });
    expect(mockLedger.recordDelivery).not.toHaveBeenCalled();
    expect(tx.transaction.deleteMany).not.toHaveBeenCalled();
    // The row is still flipped to VOIDED by the atomic claim.
    expect(tx.dailySheetItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: DeliveryStatus.VOIDED }) }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELIVERY_VOIDED' }),
    );
  });
});
