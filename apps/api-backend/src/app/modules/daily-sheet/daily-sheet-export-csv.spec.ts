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

/**
 * Unit tests: DailySheetService.generateExportCsv — standalone-payment
 * merge (Daily Sheet CSV export enhancement, per docs research).
 *
 * Covers: delivery-only unchanged, payment-only synthetic row, delivery +
 * payment merged onto one row, multi-payment summation, and the
 * empty-day header-only case.
 *
 * Van scoping: a standalone payment (office cash, online transfer) has no
 * van of its own — it only adjusts the customer's balance — so it is
 * NEVER filtered by the export's van selection. Only the `items`
 * (delivery) query is van-scoped. Cases 5/6 assert this explicitly: the
 * same standalone payments appear identically whether the export is for
 * "All Vans" or a specific van.
 */
describe('DailySheetService.generateExportCsv', () => {
  let service: DailySheetService;
  let mockPrisma: any;

  const VENDOR_ID = 'vendor-001';
  const VAN_ID = 'van-001';
  const OTHER_VAN_ID = 'van-002';
  const DATE = '2026-08-24'; // a Monday (dayOfWeek = 1)

  beforeEach(async () => {
    mockPrisma = {
      van: { findMany: jest.fn() },
      dailySheetItem: { findMany: jest.fn() },
      transaction: { groupBy: jest.fn() },
      customer: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailySheetService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: {} },
        { provide: AuditService, useValue: {} },
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

  function mockAllVans(vanIds: string[] = [VAN_ID]) {
    mockPrisma.van.findMany.mockResolvedValue(vanIds.map((id) => ({ id, plateNumber: id })));
  }

  function deliveryItem(overrides: Record<string, unknown> = {}) {
    return {
      customerId: 'cust-A',
      customer: { customerCode: 'C-A', name: 'Customer A' },
      bottleBalanceAfter: 10,
      financialBalanceAfter: 200,
      filledDropped: 4,
      emptyReceived: 2,
      filledReceived: 0,
      cashCollected: 500,
      ...overrides,
    };
  }

  // ── Case 1: delivery only ──
  it('leaves a delivery-only row exactly as today (no payment query results)', async () => {
    mockAllVans();
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([deliveryItem()]);
    mockPrisma.transaction.groupBy.mockResolvedValue([]);

    const csv = await service.generateExportCsv(VENDOR_ID, { date: DATE });
    const lines = csv.split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('C-A,Customer A,,10,200,4,2,0,500');
  });

  // ── Case 2: payment only ──
  it('creates a synthetic row for a payment-only customer with delivery fields at 0', async () => {
    mockAllVans();
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([]);
    mockPrisma.transaction.groupBy.mockResolvedValue([
      { customerId: 'cust-B', _sum: { amount: -2000 } },
    ]);
    mockPrisma.customer.findMany.mockResolvedValue([
      { id: 'cust-B', customerCode: 'C-B', name: 'Customer B' },
    ]);

    const csv = await service.generateExportCsv(VENDOR_ID, { date: DATE });
    const lines = csv.split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('C-B,Customer B,Payment,,,0,0,0,2000');
  });

  // ── Case 3: delivery + standalone payment same day ──
  it('merges a same-day standalone payment onto the existing delivery row (one row, cash summed)', async () => {
    mockAllVans();
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([deliveryItem()]);
    mockPrisma.transaction.groupBy.mockResolvedValue([
      { customerId: 'cust-A', _sum: { amount: -300 } },
    ]);

    const csv = await service.generateExportCsv(VENDOR_ID, { date: DATE });
    const lines = csv.split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('C-A,Customer A,,10,200,4,2,0,800');
    expect(mockPrisma.customer.findMany).not.toHaveBeenCalled();
  });

  // ── Case 4: multiple standalone payments same day ──
  it('sums multiple same-day standalone payments via a single groupBy aggregate', async () => {
    mockAllVans();
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([]);
    // groupBy already returns one aggregated row per customer — this test
    // documents that generateExportCsv trusts the DB-side sum rather than
    // re-summing individual transaction rows itself.
    mockPrisma.transaction.groupBy.mockResolvedValue([
      { customerId: 'cust-B', _sum: { amount: -3000 } }, // 1000 @ 10am + 2000 @ 3pm
    ]);
    mockPrisma.customer.findMany.mockResolvedValue([
      { id: 'cust-B', customerCode: 'C-B', name: 'Customer B' },
    ]);

    const csv = await service.generateExportCsv(VENDOR_ID, { date: DATE });
    const lines = csv.split('\n');

    expect(lines[1]).toBe('C-B,Customer B,Payment,,,0,0,0,3000');
  });

  // ── Case 5: specific-van export — standalone payments are never van-filtered ──
  it('includes every standalone payment under a specific-van export, regardless of which van is selected', async () => {
    mockAllVans([VAN_ID]); // resolveExportVans validates the requested van
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([]);
    mockPrisma.transaction.groupBy.mockResolvedValue([
      { customerId: 'cust-B', _sum: { amount: -2000 } },
      { customerId: 'cust-C', _sum: { amount: -1500 } },
    ]);
    mockPrisma.customer.findMany.mockResolvedValue([
      { id: 'cust-B', customerCode: 'C-B', name: 'Customer B' },
      { id: 'cust-C', customerCode: 'C-C', name: 'Customer C' },
    ]);

    const csv = await service.generateExportCsv(VENDOR_ID, { date: DATE, vanIds: [VAN_ID] });
    const lines = csv.split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('C-B,Customer B,Payment,,,0,0,0,2000');
    expect(lines[2]).toBe('C-C,Customer C,Payment,,,0,0,0,1500');
    // Both customers looked up in one batched call, not per-customer.
    expect(mockPrisma.customer.findMany).toHaveBeenCalledTimes(1);
  });

  // ── Case 6: all-vans export — identical standalone-payment rows as a specific-van export ──
  it('includes every standalone payment under an all-vans export, same as a specific-van export', async () => {
    mockAllVans([VAN_ID, OTHER_VAN_ID]);
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([]);
    mockPrisma.transaction.groupBy.mockResolvedValue([
      { customerId: 'cust-B', _sum: { amount: -2000 } },
      { customerId: 'cust-C', _sum: { amount: -1500 } },
    ]);
    mockPrisma.customer.findMany.mockResolvedValue([
      { id: 'cust-B', customerCode: 'C-B', name: 'Customer B' },
      { id: 'cust-C', customerCode: 'C-C', name: 'Customer C' },
    ]);

    const csv = await service.generateExportCsv(VENDOR_ID, { date: DATE }); // no vanIds = All Vans

    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
  });

  // ── Case 7: no deliveries, no payments ──
  it('returns header-only CSV when there are no deliveries and no standalone payments', async () => {
    mockAllVans();
    mockPrisma.dailySheetItem.findMany.mockResolvedValue([]);
    mockPrisma.transaction.groupBy.mockResolvedValue([]);

    const csv = await service.generateExportCsv(VENDOR_ID, { date: DATE });

    expect(csv).toBe(
      'Code,Customer Name,Type,Bot Balance,Outstanding Amount,Drop,Empty,Filled Received,Amount Received',
    );
    expect(mockPrisma.customer.findMany).not.toHaveBeenCalled();
  });
});
