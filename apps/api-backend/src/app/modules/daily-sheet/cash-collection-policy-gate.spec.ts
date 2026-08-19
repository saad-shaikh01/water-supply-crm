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
import { DeliveryStatus, PaymentType, UserRole } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Unit tests: the Cash Customer Collection Policy gate inside
 * DailySheetService.submitDelivery, per
 * docs/features/cash-customer-collection-policy.md §9.2.
 *
 * Focus (mirrors the monthly gate spec's structure, per the doc's §21.5
 * "gate ordering" risk and §4.9's ledger-exact back-out requirement):
 *  - A violation must throw BEFORE any ledger/transaction work.
 *  - The actual `cashCollected` value (never the rounded requirement) is
 *    what reaches the ledger.
 *  - Every exemption path (disabled, MONTHLY, billing-exempt, non-posting
 *    status, within-floor) never touches the back-out query and never blocks.
 *  - The resubmit back-out reconstructs the prior balance effect from the
 *    item's own ledger rows (DELIVERY + PAYMENT transactions), not from the
 *    item's own persisted fields — the "phantom-row" correctness §4.9 requires.
 */
describe('DailySheetService.submitDelivery — Cash Collection Policy gate', () => {
  let service: DailySheetService;
  let mockPrisma: any;
  let mockLedger: any;
  let mockAudit: any;
  let mockCollectionPolicy: any;
  let mockNotifSettings: any;
  let mockCache: any;

  const VENDOR_ID = 'vendor-001';
  const ITEM_ID = 'item-001';
  const CUSTOMER_ID = 'customer-001';
  const SHEET_DATE = new Date('2026-07-14T00:00:00.000Z');

  const STAFF_USER: AuthUser = {
    userId: 'staff-1',
    email: 's@example.com',
    name: 'Staff',
    role: UserRole.STAFF,
    vendorId: VENDOR_ID,
    customerId: null,
  };

  // N=2, floor=500, ceiling=null — the doc's own default/example config.
  const ENABLED_CASH_POLICY = {
    enabled: true,
    allowedCreditDeliveries: 2,
    minExposureFloor: 500,
    maxOutstandingCeiling: null,
  };

  const DISABLED_MONTHLY_POLICY = {
    enabled: false,
    minOutstandingThreshold: 1000,
    minCollectionPercentage: 90,
    allowedShortfall: 300,
  };

  function buildBaseItem(overrides: Record<string, unknown> = {}) {
    return {
      id: ITEM_ID,
      status: DeliveryStatus.PENDING,
      customerId: CUSTOMER_ID,
      productId: 'product-001',
      dailySheetId: 'sheet-001',
      cashCollected: 0,
      whatsappSentAt: null,
      editUnlockExpiresAt: null,
      dailySheet: { vendorId: VENDOR_ID, date: SHEET_DATE, vendor: { name: 'Test Vendor' } },
      customer: {
        name: 'Test Customer',
        customerCode: 'C001',
        phoneNumber: null, // skip the WhatsApp receipt branch entirely
        paymentType: PaymentType.CASH,
        isBillingExempt: false,
        financialBalance: 600,
        customPrices: [],
      },
      product: { name: 'Bottle', basePrice: 100 }, // filledDropped=3 -> charge=300
      ...overrides,
    };
  }

  function wireHappyPathTransaction() {
    // submitDelivery reads the post-delivery snapshot via `tx`, not
    // `this.prisma` (same-transaction visibility fix) — the tx mock needs
    // its own bottleWallet/customer.findUnique alongside the outer mockPrisma ones.
    const tx = {
      dailySheetItem: { update: jest.fn().mockResolvedValue({ id: ITEM_ID }) },
      bottleWallet: { findUnique: jest.fn().mockResolvedValue({ balance: 5 }) },
      customer: { findUnique: jest.fn().mockResolvedValue({ financialBalance: 500 }) },
    };
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
    mockPrisma.bottleWallet.findUnique.mockResolvedValue({ balance: 5 });
    mockPrisma.customer.findUnique.mockResolvedValue({ financialBalance: 500 });
  }

  beforeEach(async () => {
    mockLedger = { recordDelivery: jest.fn().mockResolvedValue({ success: true }) };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockCollectionPolicy = {
      getPolicy: jest.fn().mockResolvedValue(DISABLED_MONTHLY_POLICY),
      getCashPolicy: jest.fn().mockResolvedValue(ENABLED_CASH_POLICY),
    };
    mockNotifSettings = { isEnabled: jest.fn().mockResolvedValue(false) };
    mockCache = {
      invalidateDailyDashboard: jest.fn().mockResolvedValue(undefined),
      invalidateOverview: jest.fn().mockResolvedValue(undefined),
      invalidateAnalytics: jest.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      // aggregate defaults give the van-stock gate ample headroom (1000 loaded,
      // nothing else delivered/received) so it never interferes with these
      // cash-collection-policy-only tests, which all submit filledDropped: 1.
      dailySheetItem: {
        findUnique: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { filledDropped: 0, filledReceived: 0 } }),
      },
      dailySheetLoad: {
        findFirst: jest.fn().mockResolvedValue({ id: 'load-1', endedAt: null }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { loadedFilled: 1000 } }),
      },
      conversationMessage: { count: jest.fn().mockResolvedValue(0) },
      transaction: { aggregate: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      bottleWallet: { findUnique: jest.fn() },
      customer: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailySheetService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: mockLedger },
        { provide: AuditService, useValue: mockAudit },
        { provide: FcmService, useValue: {} },
        // Unlike the monthly gate spec, this file exercises a NOT_AVAILABLE
        // submission (§4.5.4 exemption test) — submitDelivery's existing
        // auto-issue-creation branch calls createForItem for that status.
        { provide: DeliveryIssueService, useValue: { createForItem: jest.fn().mockResolvedValue(undefined) } },
        { provide: CacheInvalidationService, useValue: mockCache },
        { provide: NotificationService, useValue: { queueWhatsAppPdf: jest.fn() } },
        { provide: InAppNotificationService, useValue: {} },
        { provide: NotificationSettingsService, useValue: mockNotifSettings },
        { provide: CollectionPolicyService, useValue: mockCollectionPolicy },
        { provide: CrewCashDistributionService, useValue: {} },
        // Not exercised by submitDelivery — only wired so Nest can resolve
        // DailySheetService's full constructor (Fleet Phase 1 / Sheet
        // Discrepancy Case deps, added after this suite was written).
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
    (service as any).notifSettings = mockNotifSettings;
    (service as any).collectionPolicy = mockCollectionPolicy;
  });

  afterEach(() => jest.clearAllMocks());

  // ── Gate ordering: violation throws before any ledger/transaction work ───

  it('throws before $transaction/ledger.recordDelivery when cash is below the required minimum', async () => {
    // balance=600, charge=3*100=300 -> exposure=900, required=floor10(300)=300.
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildBaseItem());

    await expect(
      service.submitDelivery(STAFF_USER, ITEM_ID, {
        status: DeliveryStatus.COMPLETED,
        filledDropped: 3,
        emptyReceived: 0,
        filledReceived: 0,
        cashCollected: 100, // below the required 300
      } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CASH_COLLECTION_POLICY_VIOLATION',
        applies: true,
        satisfied: false,
        reason: 'BELOW_MINIMUM',
        requiredAmount: 300,
        collectedAmount: 100,
        exposure: 900,
      }),
    });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockLedger.recordDelivery).not.toHaveBeenCalled();
    expect(mockPrisma.dailySheetLoad.findFirst).not.toHaveBeenCalled();
  });

  // ── Happy path: the ACTUAL collected amount reaches the ledger, never the rounded minimum ─

  it('proceeds unchanged when cash meets the requirement, passing the actual amount (not the rounded minimum) to the ledger', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildBaseItem());
    wireHappyPathTransaction();

    // Required is 300; the driver actually collects 500 (voluntary overpayment).
    await service.submitDelivery(STAFF_USER, ITEM_ID, {
      status: DeliveryStatus.COMPLETED,
      filledDropped: 3,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 500,
    } as any);

    expect(mockLedger.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ cashCollected: 500 }), // actual amount, never the Rs.300 requirement
      expect.anything(),
    );
  });

  it('an exact-boundary payment (== requiredAmount) satisfies the policy', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildBaseItem());
    wireHappyPathTransaction();

    await service.submitDelivery(STAFF_USER, ITEM_ID, {
      status: DeliveryStatus.COMPLETED,
      filledDropped: 3,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 300, // exactly the requirement
    } as any);

    expect(mockLedger.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ cashCollected: 300 }),
      expect.anything(),
    );
  });

  // ── Exemptions never touch the back-out query and never block ────────────

  it('skips the gate entirely (no back-out query) when the cash policy is disabled', async () => {
    mockCollectionPolicy.getCashPolicy.mockResolvedValue({ ...ENABLED_CASH_POLICY, enabled: false });
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildBaseItem());
    wireHappyPathTransaction();

    await service.submitDelivery(STAFF_USER, ITEM_ID, {
      status: DeliveryStatus.COMPLETED,
      filledDropped: 3,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 1, // would violate if the policy were enabled
    } as any);

    expect(mockPrisma.transaction.findFirst).not.toHaveBeenCalled();
    expect(mockLedger.recordDelivery).toHaveBeenCalled();
  });

  it('skips the gate entirely for MONTHLY-type customers', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildBaseItem({ customer: { ...buildBaseItem().customer, paymentType: PaymentType.MONTHLY } }),
    );
    wireHappyPathTransaction();

    await service.submitDelivery(STAFF_USER, ITEM_ID, {
      status: DeliveryStatus.COMPLETED,
      filledDropped: 3,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 1,
    } as any);

    expect(mockCollectionPolicy.getCashPolicy).not.toHaveBeenCalled();
    expect(mockPrisma.transaction.findFirst).not.toHaveBeenCalled();
    expect(mockLedger.recordDelivery).toHaveBeenCalled();
  });

  it('skips the gate entirely for billing-exempt CASH customers', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildBaseItem({ customer: { ...buildBaseItem().customer, isBillingExempt: true } }),
    );
    wireHappyPathTransaction();

    await service.submitDelivery(STAFF_USER, ITEM_ID, {
      status: DeliveryStatus.COMPLETED,
      filledDropped: 3,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 1,
    } as any);

    expect(mockPrisma.transaction.findFirst).not.toHaveBeenCalled();
    expect(mockLedger.recordDelivery).toHaveBeenCalled();
  });

  it('never blocks a non-posting (failure) status, regardless of balance size — chargeAmount is forced to 0', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildBaseItem({ customer: { ...buildBaseItem().customer, financialBalance: 50000 } }),
    );
    wireHappyPathTransaction();

    // Must not throw: chargeAmount=0 for a non-posting status always exempts the
    // gate (NO_CHARGE), regardless of how large the existing balance is.
    await expect(
      service.submitDelivery(STAFF_USER, ITEM_ID, {
        status: DeliveryStatus.NOT_AVAILABLE,
        filledDropped: 0,
        emptyReceived: 0,
        filledReceived: 0,
        cashCollected: 0,
      } as any),
    ).resolves.toBeDefined();

    // NOT_AVAILABLE doesn't post a delivery/payment to the ledger at all
    // (submitDelivery only calls recordDelivery for COMPLETED/EMPTY_ONLY) —
    // this is pre-existing, unrelated behavior, asserted here only to confirm
    // the cash gate did not itself force an unexpected ledger call.
    expect(mockLedger.recordDelivery).not.toHaveBeenCalled();
  });

  it('saves normally when exposure is within the floor (small balance/bill combo)', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildBaseItem({ customer: { ...buildBaseItem().customer, financialBalance: 100 } }),
    );
    wireHappyPathTransaction();

    // balance=100, charge=1*100=100 -> exposure=200 <= floor(500) -> exempt.
    await service.submitDelivery(STAFF_USER, ITEM_ID, {
      status: DeliveryStatus.COMPLETED,
      filledDropped: 1,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 0,
    } as any);

    expect(mockLedger.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ cashCollected: 0 }),
      expect.anything(),
    );
  });

  // ── Ledger-exact resubmit back-out (§4.9) ─────────────────────────────────

  describe('resubmit back-out reconstructs the prior effect from the item\'s own LEDGER ROWS', () => {
    it('an unchanged resubmit (same cash as before) still satisfies the policy', async () => {
      // Ledger rows say: this item previously posted a charge of 300 and a
      // payment of -300 (net 0 effect) -> prior effect = 0.
      // currentBalance = financialBalance(600) - priorEffect(0) = 600.
      // charge=300 again -> exposure=900, required=300 -> paying 300 again satisfies.
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
        buildBaseItem({ status: DeliveryStatus.COMPLETED, cashCollected: 300 }),
      );
      mockPrisma.transaction.findFirst
        .mockResolvedValueOnce({ amount: 300 }) // DELIVERY row (positive charge)
        .mockResolvedValueOnce({ amount: -300 }); // PAYMENT row (negative cash)
      wireHappyPathTransaction();

      await service.submitDelivery(STAFF_USER, ITEM_ID, {
        status: DeliveryStatus.COMPLETED,
        filledDropped: 3,
        emptyReceived: 0,
        filledReceived: 0,
        cashCollected: 300,
        forceResubmit: true,
      } as any);

      expect(mockLedger.recordDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ cashCollected: 300 }),
        expect.anything(),
      );
    });

    it('uses the ledger rows, NOT the item\'s own persisted fields — proves the phantom-row correctness the doc requires', async () => {
      // The item's own `cashCollected` field says 9999 (a stale/irrelevant value —
      // e.g. from a COMPLETED->NOT_AVAILABLE->resubmit path where fields were reset
      // but ledger rows were left behind). If the gate used item fields, the
      // back-out would be wildly wrong. It must use the ledger rows instead:
      // DELIVERY=300, PAYMENT=-300 -> priorEffect=0 -> currentBalance=600 (unchanged).
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
        buildBaseItem({ status: DeliveryStatus.COMPLETED, cashCollected: 9999 }),
      );
      mockPrisma.transaction.findFirst
        .mockResolvedValueOnce({ amount: 300 })
        .mockResolvedValueOnce({ amount: -300 });

      // exposure = 600 + 300 = 900, required = 300. A payment of 100 must still
      // be rejected with requiredAmount=300 (proving currentBalance was NOT
      // computed as 600 - 9999 = -9399, which would have made this exempt).
      await expect(
        service.submitDelivery(STAFF_USER, ITEM_ID, {
          status: DeliveryStatus.COMPLETED,
          filledDropped: 3,
          emptyReceived: 0,
          filledReceived: 0,
          cashCollected: 100,
          forceResubmit: true,
        } as any),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'CASH_COLLECTION_POLICY_VIOLATION',
          requiredAmount: 300,
          currentBalance: 600,
          exposure: 900,
        }),
      });
    });

    it('a resubmit with no prior ledger rows at all (defensive: findFirst returns null) treats prior effect as 0', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
        buildBaseItem({ status: DeliveryStatus.COMPLETED, cashCollected: 0 }),
      );
      mockPrisma.transaction.findFirst
        .mockResolvedValueOnce(null) // no DELIVERY row found
        .mockResolvedValueOnce(null); // no PAYMENT row found
      wireHappyPathTransaction();

      await service.submitDelivery(STAFF_USER, ITEM_ID, {
        status: DeliveryStatus.COMPLETED,
        filledDropped: 3,
        emptyReceived: 0,
        filledReceived: 0,
        cashCollected: 300,
        forceResubmit: true,
      } as any);

      expect(mockLedger.recordDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ cashCollected: 300 }),
        expect.anything(),
      );
    });
  });

  // ── Rounding + accounting invariant at the exact boundary ────────────────

  describe('rounding boundary: requiredAmount is rounded, cashCollected never is', () => {
    it('a payment exactly at the rounded requirement (340) satisfies; one rupee short (339) does not', async () => {
      // balance=1029 (chosen so exposure/(N+1) lands on raw=343 -> floor10=340),
      // charge=0 via a fresh item with financialBalance already at exposure level.
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
        buildBaseItem({ customer: { ...buildBaseItem().customer, financialBalance: 729 } }),
      ); // exposure = 729 + 3*100 = 1029 -> required = floor10(1029/3) = floor10(343) = 340
      wireHappyPathTransaction();

      await service.submitDelivery(STAFF_USER, ITEM_ID, {
        status: DeliveryStatus.COMPLETED,
        filledDropped: 3,
        emptyReceived: 0,
        filledReceived: 0,
        cashCollected: 340,
      } as any);

      expect(mockLedger.recordDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ cashCollected: 340 }),
        expect.anything(),
      );
    });

    it('one rupee short of the rounded requirement is rejected with the exact rounded figure', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
        buildBaseItem({ customer: { ...buildBaseItem().customer, financialBalance: 729 } }),
      );

      await expect(
        service.submitDelivery(STAFF_USER, ITEM_ID, {
          status: DeliveryStatus.COMPLETED,
          filledDropped: 3,
          emptyReceived: 0,
          filledReceived: 0,
          cashCollected: 339,
        } as any),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'CASH_COLLECTION_POLICY_VIOLATION',
          requiredAmount: 340,
          collectedAmount: 339,
        }),
      });
    });
  });
});
