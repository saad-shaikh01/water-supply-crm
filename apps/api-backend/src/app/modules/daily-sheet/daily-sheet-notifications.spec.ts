import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { DailySheetService } from './daily-sheet.service';
import { FcmService } from '../fcm/fcm.service';
import { LedgerService } from '../transaction/ledger.service';
import { AuditService } from '../audit/audit.service';
import { DeliveryIssueService } from '../delivery-issue/delivery-issue.service';
import { DeliveryStatus } from '@prisma/client';
import { QUEUE_NAMES, NOTIFICATION_EVENTS } from '@water-supply-crm/queue';

/**
 * Unit tests: DailySheetService delivery failure notification triggers
 *
 * Verifies that submitDelivery sends a customer FCM push for every failure
 * status (NOT_AVAILABLE, RESCHEDULED, CANCELLED) and does NOT send the
 * failure push for successful deliveries (COMPLETED, EMPTY_ONLY).
 */
describe('DailySheetService — delivery failure notifications', () => {
  let service: DailySheetService;
  let mockFcm: { sendToCustomer: jest.Mock; sendToVendorUsers: jest.Mock };
  let mockPrisma: any;
  let mockLedger: any;
  let mockAudit: any;
  let mockDeliveryIssue: any;

  const VENDOR_ID = 'vendor-001';
  const ITEM_ID   = 'item-001';
  const CUSTOMER_ID = 'customer-001';

  // A minimal DailySheetItem that satisfies the service's .findUnique include shape
  const baseItem = {
    id: ITEM_ID,
    customerId: CUSTOMER_ID,
    productId: 'product-001',
    dailySheetId: 'sheet-001',
    dailySheet: { vendorId: VENDOR_ID },
    customer: { customPrices: [], id: CUSTOMER_ID },
    product: { basePrice: 100, id: 'product-001' },
  };

  // A reusable mock tx; dailySheetItem.update returns the item with the submitted status
  function buildMockTx(status: DeliveryStatus) {
    return {
      dailySheetItem: {
        update: jest.fn().mockResolvedValue({ id: ITEM_ID, status }),
      },
    };
  }

  beforeEach(async () => {
    mockFcm = {
      sendToCustomer: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
      sendToVendorUsers: jest.fn().mockResolvedValue({ sent: 0, failed: 0 }),
    };

    mockLedger = { recordDelivery: jest.fn().mockResolvedValue({ success: true }) };
    mockAudit  = { log: jest.fn().mockResolvedValue(undefined) };
    mockDeliveryIssue = { createForItem: jest.fn().mockResolvedValue(undefined) };

    mockPrisma = {
      dailySheetItem: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailySheetService,
        { provide: 'PrismaService',          useValue: mockPrisma },
        { provide: LedgerService,             useValue: mockLedger },
        { provide: AuditService,              useValue: mockAudit },
        { provide: FcmService,                useValue: mockFcm },
        { provide: DeliveryIssueService,      useValue: mockDeliveryIssue },
        {
          provide: getQueueToken(QUEUE_NAMES.DAILY_SHEET_GENERATION),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<DailySheetService>(DailySheetService);
    // Direct injection for reliability (DI tokens differ in unit tests)
    (service as any).prisma         = mockPrisma;
    (service as any).fcm            = mockFcm;
    (service as any).ledger         = mockLedger;
    (service as any).audit          = mockAudit;
    (service as any).deliveryIssue  = mockDeliveryIssue;
  });

  afterEach(() => jest.clearAllMocks());

  // ── Helper: wire up prisma.$transaction to call the callback ──────────────
  function wireTransaction(status: DeliveryStatus) {
    mockPrisma.dailySheetItem.findUnique.mockResolvedValue(baseItem);
    const tx = buildMockTx(status);
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
  }

  // ── 1. Failure statuses trigger customer FCM ──────────────────────────────

  it.each([
    [DeliveryStatus.NOT_AVAILABLE],
    [DeliveryStatus.RESCHEDULED],
    [DeliveryStatus.CANCELLED],
  ])('sends customer FCM for failure status %s', async (status) => {
    wireTransaction(status);

    await service.submitDelivery(VENDOR_ID, ITEM_ID, {
      status,
      filledDropped: 0,
      emptyReceived: 0,
      cashCollected: 0,
      reason: 'Customer not home',
    });
    await Promise.resolve(); // flush fire-and-forget

    expect(mockFcm.sendToCustomer).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.stringContaining('Unsuccessful'),
      expect.stringContaining('Customer not home'),
      expect.objectContaining({
        type: NOTIFICATION_EVENTS.DELIVERY_FAILED,
        itemId: ITEM_ID,
      }),
    );
  });

  it('includes reason in FCM body when provided', async () => {
    wireTransaction(DeliveryStatus.NOT_AVAILABLE);

    await service.submitDelivery(VENDOR_ID, ITEM_ID, {
      status: DeliveryStatus.NOT_AVAILABLE,
      filledDropped: 0,
      emptyReceived: 0,
      cashCollected: 0,
      reason: 'Door locked',
    });
    await Promise.resolve();

    const [, , body] = mockFcm.sendToCustomer.mock.calls[0];
    expect(body).toContain('Door locked');
  });

  it('uses fallback message when no reason given', async () => {
    wireTransaction(DeliveryStatus.NOT_AVAILABLE);

    await service.submitDelivery(VENDOR_ID, ITEM_ID, {
      status: DeliveryStatus.NOT_AVAILABLE,
      filledDropped: 0,
      emptyReceived: 0,
      cashCollected: 0,
    });
    await Promise.resolve();

    const [, , body] = mockFcm.sendToCustomer.mock.calls[0];
    expect(body).toContain('contact support');
  });

  // ── 2. Successful statuses do NOT trigger failure FCM ────────────────────

  it.each([
    [DeliveryStatus.COMPLETED,   { filledDropped: 2, emptyReceived: 1, cashCollected: 200 }],
    [DeliveryStatus.EMPTY_ONLY,  { filledDropped: 0, emptyReceived: 2, cashCollected: 0   }],
  ])('does NOT send failure FCM for status %s', async (status, dto) => {
    wireTransaction(status);

    await service.submitDelivery(VENDOR_ID, ITEM_ID, {
      status,
      ...dto,
    });
    await Promise.resolve();

    const failureCalls = mockFcm.sendToCustomer.mock.calls.filter(
      (c: any[]) => c[3]?.type === NOTIFICATION_EVENTS.DELIVERY_FAILED,
    );
    expect(failureCalls).toHaveLength(0);
  });

  // ── 3. DELIVERY_FAILED constant is correct ────────────────────────────────

  it('DELIVERY_FAILED event constant has expected value', () => {
    expect(NOTIFICATION_EVENTS.DELIVERY_FAILED).toBe('delivery.failed');
  });
});
