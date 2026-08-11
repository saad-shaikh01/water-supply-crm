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
import { StorageService } from '../../common/storage/storage.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { DeliveryReceiptPdfService } from '../whatsapp/delivery-receipt-pdf.service';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { DeliveryStatus, PaymentType, UserRole } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Unit tests: the Monthly Customer Collection Policy gate inside
 * DailySheetService.submitDelivery, per
 * docs/features/monthly-customer-collection-policy.md §6.3.
 *
 * Focus (per the locked plan's Phase 1 test requirements):
 *  - Risk #2 (gate ordering): a violation must throw BEFORE any ledger/
 *    transaction work — never inside or after $transaction.
 *  - Risk #3 (resubmit back-out): re-recording a delivery must not let the
 *    item's own previously-saved cash double-count against the new amount.
 *  - The `enabled=false` / CASH / billing-exempt / zero-cash exemptions never
 *    block a save.
 */
describe('DailySheetService.submitDelivery — Collection Policy gate', () => {
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

  const ENABLED_POLICY = {
    enabled: true,
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
        paymentType: PaymentType.MONTHLY,
        isBillingExempt: false,
        financialBalance: 2000,
        customPrices: [],
      },
      product: { name: 'Bottle', basePrice: 100 },
      ...overrides,
    };
  }

  function wireHappyPathTransaction() {
    const tx = { dailySheetItem: { update: jest.fn().mockResolvedValue({ id: ITEM_ID }) } };
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
    mockPrisma.bottleWallet.findUnique.mockResolvedValue({ balance: 5 });
    mockPrisma.customer.findUnique.mockResolvedValue({ financialBalance: 500 });
  }

  beforeEach(async () => {
    mockLedger = { recordDelivery: jest.fn().mockResolvedValue({ success: true }) };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockCollectionPolicy = {
      getPolicy: jest.fn().mockResolvedValue(ENABLED_POLICY),
      // Cash Collection Policy gate now runs unconditionally for CASH-type
      // customers alongside this monthly gate (docs/features/cash-customer-collection-policy.md
      // §9.2) — default disabled so these monthly-only tests are unaffected.
      getCashPolicy: jest.fn().mockResolvedValue({
        enabled: false,
        allowedCreditDeliveries: 2,
        minExposureFloor: 500,
        maxOutstandingCeiling: null,
      }),
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
      // collection-policy-only tests, which all submit filledDropped: 1.
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
      transaction: { aggregate: jest.fn() },
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
        { provide: DeliveryIssueService, useValue: {} },
        { provide: CacheInvalidationService, useValue: mockCache },
        { provide: NotificationService, useValue: { queueWhatsAppPdf: jest.fn() } },
        { provide: InAppNotificationService, useValue: {} },
        { provide: NotificationSettingsService, useValue: mockNotifSettings },
        { provide: CollectionPolicyService, useValue: mockCollectionPolicy },
        { provide: CrewCashDistributionService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: WarehouseService, useValue: {} },
        { provide: DeliveryReceiptPdfService, useValue: {} },
        { provide: getQueueToken(QUEUE_NAMES.DAILY_SHEET_GENERATION), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<DailySheetService>(DailySheetService);
    // Direct injection for reliability, matching ledger-record-delivery.spec.ts.
    (service as any).prisma = mockPrisma;
    (service as any).ledger = mockLedger;
    (service as any).audit = mockAudit;
    (service as any).cache = mockCache;
    (service as any).notifSettings = mockNotifSettings;
    (service as any).collectionPolicy = mockCollectionPolicy;
  });

  afterEach(() => jest.clearAllMocks());

  // ── Risk #2: violation throws before any ledger/transaction work ─────────

  it('throws before $transaction/ledger.recordDelivery when cash is below the required minimum', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildBaseItem());
    // remaining = 2000 (no current-month activity); required = round(1800)-300 = 1500
    mockPrisma.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 0 } }) // fromCurrentMonth
      .mockResolvedValueOnce({ _sum: { amount: 0 } }); // curPayments

    await expect(
      service.submitDelivery(STAFF_USER, ITEM_ID, {
        status: DeliveryStatus.COMPLETED,
        filledDropped: 1,
        emptyReceived: 0,
        filledReceived: 0,
        cashCollected: 100, // below the required 1500
      } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'COLLECTION_POLICY_VIOLATION',
        applies: true,
        satisfied: false,
        reason: 'BELOW_MINIMUM',
        requiredAmount: 1500,
        collectedAmount: 100,
      }),
    });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockLedger.recordDelivery).not.toHaveBeenCalled();
    // The gate must also fire before the active-trip check that follows it.
    expect(mockPrisma.dailySheetLoad.findFirst).not.toHaveBeenCalled();
  });

  it('proceeds through the existing ledger flow unchanged when cash meets the required minimum', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildBaseItem());
    mockPrisma.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: 0 } });
    wireHappyPathTransaction();

    await service.submitDelivery(STAFF_USER, ITEM_ID, {
      status: DeliveryStatus.COMPLETED,
      filledDropped: 1,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 1500,
    } as any);

    expect(mockLedger.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ cashCollected: 1500 }),
      expect.anything(),
    );
    // No zero-cash audit event when cash was actually collected.
    expect(mockAudit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COLLECTION_POLICY_ZERO_CASH' }),
    );
  });

  // ── Cash = 0 is always a valid, unblocked business case ───────────────────

  it('always saves when cash collected is 0, and logs the COLLECTION_POLICY_ZERO_CASH audit event', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildBaseItem());
    mockPrisma.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: 0 } });
    wireHappyPathTransaction();

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
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: VENDOR_ID,
        action: 'COLLECTION_POLICY_ZERO_CASH',
        entity: 'DailySheetItem',
        entityId: ITEM_ID,
      }),
    );
  });

  // ── Exemptions never touch the DB or block the save ───────────────────────

  it('skips the gate entirely (no aggregate queries) when the policy is disabled', async () => {
    mockCollectionPolicy.getPolicy.mockResolvedValue({ ...ENABLED_POLICY, enabled: false });
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildBaseItem());
    wireHappyPathTransaction();

    await service.submitDelivery(STAFF_USER, ITEM_ID, {
      status: DeliveryStatus.COMPLETED,
      filledDropped: 1,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 1, // would violate if the policy were enabled
    } as any);

    expect(mockPrisma.transaction.aggregate).not.toHaveBeenCalled();
    expect(mockLedger.recordDelivery).toHaveBeenCalled();
  });

  it('skips the gate entirely for CASH-type customers', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildBaseItem({ customer: { ...buildBaseItem().customer, paymentType: PaymentType.CASH } }),
    );
    wireHappyPathTransaction();

    await service.submitDelivery(STAFF_USER, ITEM_ID, {
      status: DeliveryStatus.COMPLETED,
      filledDropped: 1,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 1,
    } as any);

    expect(mockPrisma.transaction.aggregate).not.toHaveBeenCalled();
    expect(mockLedger.recordDelivery).toHaveBeenCalled();
  });

  it('skips the gate entirely for billing-exempt customers', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildBaseItem({ customer: { ...buildBaseItem().customer, isBillingExempt: true } }),
    );
    wireHappyPathTransaction();

    await service.submitDelivery(STAFF_USER, ITEM_ID, {
      status: DeliveryStatus.COMPLETED,
      filledDropped: 1,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 1,
    } as any);

    expect(mockPrisma.transaction.aggregate).not.toHaveBeenCalled();
    expect(mockLedger.recordDelivery).toHaveBeenCalled();
  });

  // ── Risk #3: resubmit back-out correctness ─────────────────────────────────

  describe('resubmit back-out (forceResubmit on a previously COMPLETED item)', () => {
    // Previously saved cashCollected = 1500 is already reflected in this
    // month's PAYMENT aggregate; financialBalance = 2000, and this month's
    // net activity (charge 1500 - payment 1500) is 0, so prevMonthOutstanding
    // (financialBalance - fromCurrentMonth) is 2000 regardless of back-out —
    // only currentMonthPaid needs the item's old cash subtracted out.
    function buildResubmitItem() {
      return buildBaseItem({
        status: DeliveryStatus.COMPLETED,
        cashCollected: 1500, // the item's own previously-saved value
      });
    }

    it('does NOT double-count the item\'s own prior payment: a reduced amount that would wrongly pass without back-out is correctly rejected', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildResubmitItem());
      mockPrisma.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 0 } }) // fromCurrentMonth: charge(1500) + payment(-1500) = 0
        .mockResolvedValueOnce({ _sum: { amount: -1500 } }); // curPayments: this item's old payment

      // Without the §6.3.3 back-out, remaining would be computed as
      // max(2000 - 1500, 0) = 500 -> required = 150, and 200 would incorrectly
      // pass. With the back-out, remaining = 2000 -> required = 1500, so 200
      // must be rejected.
      await expect(
        service.submitDelivery(STAFF_USER, ITEM_ID, {
          status: DeliveryStatus.COMPLETED,
          filledDropped: 1,
          emptyReceived: 0,
          filledReceived: 0,
          cashCollected: 200,
          forceResubmit: true,
        } as any),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'COLLECTION_POLICY_VIOLATION',
          requiredAmount: 1500,
          remainingPreviousOutstanding: 2000,
        }),
      });
    });

    it('an unchanged resubmit (same cash as before) still satisfies the policy', async () => {
      mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildResubmitItem());
      mockPrisma.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 0 } })
        .mockResolvedValueOnce({ _sum: { amount: -1500 } });
      wireHappyPathTransaction();

      await service.submitDelivery(STAFF_USER, ITEM_ID, {
        status: DeliveryStatus.COMPLETED,
        filledDropped: 1,
        emptyReceived: 0,
        filledReceived: 0,
        cashCollected: 1500,
        forceResubmit: true,
      } as any);

      expect(mockLedger.recordDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ cashCollected: 1500 }),
        expect.anything(),
      );
    });
  });

  // ── Overpayment: no upper bound (§3.2, §3.3) ──────────────────────────────

  it('accepts overpayment far above the required amount — no ceiling exists', async () => {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(buildBaseItem());
    // remaining = 2000, required = 1500
    mockPrisma.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: 0 } });
    wireHappyPathTransaction();

    await service.submitDelivery(STAFF_USER, ITEM_ID, {
      status: DeliveryStatus.COMPLETED,
      filledDropped: 1,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 5000, // far more than the Rs.1500 requirement
    } as any);

    expect(mockLedger.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ cashCollected: 5000 }),
      expect.anything(),
    );
  });

  // ── Multiple items, same customer, same sheet (Edge Case §11.5) ──────────

  describe('multiple items, same customer, same sheet', () => {
    it("an earlier item's accepted cash reduces the required amount for a later item on the same visit", async () => {
      // Item A: no current-month activity has posted yet. remaining = 2000,
      // required = 1500.
      mockPrisma.dailySheetItem.findUnique.mockResolvedValueOnce(buildBaseItem({ id: 'item-A' }));
      mockPrisma.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 0 } }) // fromCurrentMonth
        .mockResolvedValueOnce({ _sum: { amount: 0 } }); // curPayments
      wireHappyPathTransaction();

      await service.submitDelivery(STAFF_USER, 'item-A', {
        status: DeliveryStatus.COMPLETED,
        filledDropped: 1,
        emptyReceived: 0,
        filledReceived: 0,
        cashCollected: 1500,
      } as any);
      expect(mockLedger.recordDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ dailySheetItemId: 'item-A', cashCollected: 1500 }),
        expect.anything(),
      );

      // Item B: a different item, same customer/sheet. Item A's payment has
      // now posted (reflected in currentMonthPaid); item B's own saved cash
      // is still 0 (a fresh PENDING item), so no back-out applies to it.
      // remaining = 2000 - (1500 - 0) = 500; required = max(0, 450-300) = 150
      // — a much smaller amount than item A needed, and it must be accepted.
      mockPrisma.dailySheetItem.findUnique.mockResolvedValueOnce(
        buildBaseItem({ id: 'item-B', productId: 'product-002' }),
      );
      mockPrisma.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 0 } }) // fromCurrentMonth: charge(1500)+payment(-1500) nets to 0
        .mockResolvedValueOnce({ _sum: { amount: -1500 } }); // curPayments: item A's posted payment

      await service.submitDelivery(STAFF_USER, 'item-B', {
        status: DeliveryStatus.COMPLETED,
        filledDropped: 1,
        emptyReceived: 0,
        filledReceived: 0,
        cashCollected: 150,
      } as any);

      expect(mockLedger.recordDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ dailySheetItemId: 'item-B', cashCollected: 150 }),
        expect.anything(),
      );
    });
  });

  // ── Month boundary / late-recorded sheets (Edge Case §11.9) ──────────────

  it('anchors the remaining-outstanding window to dailySheet.date, never to "today"', async () => {
    const JANUARY_SHEET_DATE = new Date(2026, 0, 15); // local time, unambiguous month
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(
      buildBaseItem({
        dailySheet: { vendorId: VENDOR_ID, date: JANUARY_SHEET_DATE, vendor: { name: 'Test Vendor' } },
      }),
    );
    mockPrisma.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: 0 } });
    wireHappyPathTransaction();

    await service.submitDelivery(STAFF_USER, ITEM_ID, {
      status: DeliveryStatus.COMPLETED,
      filledDropped: 1,
      emptyReceived: 0,
      filledReceived: 0,
      cashCollected: 1500,
    } as any);

    const [fromCurrentMonthCall, curPaymentsCall] = mockPrisma.transaction.aggregate.mock.calls;
    const januaryStart = new Date(2026, 0, 1);
    const februaryStart = new Date(2026, 1, 1);

    // The aggregation window must follow the sheet's own month (January),
    // not the wall-clock month the test actually runs in.
    expect(fromCurrentMonthCall[0].where.createdAt).toEqual({ gte: januaryStart });
    expect(curPaymentsCall[0].where.createdAt).toEqual({ gte: januaryStart, lt: februaryStart });
  });
});
