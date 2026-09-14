import { ConflictException, NotFoundException } from '@nestjs/common';
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
import { StaffAttendanceService } from '../payroll/staff-attendance.service';
import { VehicleCheckService } from '../fleet/vehicle-check.service';
import { SheetDiscrepancyCaseService } from '../sheet-discrepancy-case/sheet-discrepancy-case.service';
import { VanCashLedgerService } from '../van-cash-ledger/van-cash-ledger.service';
import { StorageService } from '../../common/storage/storage.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { DeliveryReceiptPdfService } from '../whatsapp/delivery-receipt-pdf.service';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { CrewRole, DailySheetKind, UserRole } from '@prisma/client';

/**
 * Merge-review finding H4: `DailySheetService.confirmCrew()` itself had zero
 * test coverage anywhere — every existing test exercised
 * `StaffAttendanceService.captureForConfirmedCrew` in isolation, never through
 * the real controller -> service -> single-transaction composition. This
 * suite closes that gap: it asserts confirmCrew's own contract (404/409,
 * idempotent-vs-flip branching, audit-log-once, absentUserIds threading) and
 * that captureForConfirmedCrew is called with the exact sheet snapshot inside
 * the SAME transaction as the crewConfirmed flip.
 */
describe('DailySheetService.confirmCrew', () => {
  let service: DailySheetService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockStaffAttendance: any;
  let tx: any;

  const VENDOR_ID = 'vendor-001';
  const SHEET_ID = 'sheet-001';
  const DRIVER_ID = 'driver-001';
  const ACTOR = { userId: 'manager-001', vendorId: VENDOR_ID, role: 'STAFF' } as any;
  const SHEET_DATE = new Date('2026-08-06T00:00:00.000Z');

  const CREW_INCLUDE_SHAPE = {
    driver: { id: DRIVER_ID, name: 'Driver One' },
    crew: [
      { userId: 'loader-001', role: CrewRole.LOADER, user: { id: 'loader-001', name: 'Loader One', role: UserRole.LOADER } },
    ],
    crewConfirmedBy: null,
  };

  function buildSheet(overrides: Record<string, unknown> = {}) {
    return {
      id: SHEET_ID,
      vendorId: VENDOR_ID,
      kind: DailySheetKind.ROUTE,
      date: SHEET_DATE,
      driverId: DRIVER_ID,
      isClosed: false,
      crewConfirmed: false,
      ...CREW_INCLUDE_SHAPE,
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockStaffAttendance = { captureForConfirmedCrew: jest.fn().mockResolvedValue({ captured: 2, reconciled: 0 }) };

    tx = {
      dailySheet: {
        update: jest.fn().mockImplementation(async ({ data }: any) => buildSheet(data)),
        findUniqueOrThrow: jest.fn().mockImplementation(async () => buildSheet({ crewConfirmed: true })),
      },
    };

    mockPrisma = {
      dailySheet: { findFirst: jest.fn().mockResolvedValue(buildSheet()) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
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
        { provide: NotificationSettingsService, useValue: {} },
        { provide: CollectionPolicyService, useValue: {} },
        { provide: CrewCashDistributionService, useValue: {} },
        { provide: StaffAttendanceService, useValue: mockStaffAttendance },
        { provide: VehicleCheckService, useValue: {} },
        { provide: SheetDiscrepancyCaseService, useValue: {} },
        { provide: VanCashLedgerService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: WarehouseService, useValue: {} },
        { provide: DeliveryReceiptPdfService, useValue: {} },
        {
          provide: getQueueToken(QUEUE_NAMES.DAILY_SHEET_GENERATION),
          useValue: { add: jest.fn(), getRepeatableJobs: jest.fn().mockResolvedValue([]), upsertJobScheduler: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<DailySheetService>(DailySheetService);
    (service as any).prisma = mockPrisma;
    (service as any).audit = mockAudit;
    (service as any).staffAttendance = mockStaffAttendance;
  });

  afterEach(() => jest.clearAllMocks());

  it('throws NotFoundException when the sheet does not exist in this vendor', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(null);
    await expect(service.confirmCrew(VENDOR_ID, SHEET_ID, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws ConflictException when the sheet is already closed', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet({ isClosed: true }));
    await expect(service.confirmCrew(VENDOR_ID, SHEET_ID, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('first confirm: flips crewConfirmed inside the transaction, calls captureForConfirmedCrew with the exact sheet snapshot, and writes ONE audit log', async () => {
    const result = await service.confirmCrew(VENDOR_ID, SHEET_ID, ACTOR);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.dailySheet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SHEET_ID },
        data: expect.objectContaining({ crewConfirmed: true, crewConfirmedById: ACTOR.userId }),
      }),
    );
    expect(tx.dailySheet.findUniqueOrThrow).not.toHaveBeenCalled();

    // captureForConfirmedCrew runs INSIDE the same tx, with the driver +
    // DailySheetCrew roster derived from the just-updated sheet row.
    expect(mockStaffAttendance.captureForConfirmedCrew).toHaveBeenCalledWith(
      tx,
      VENDOR_ID,
      {
        id: SHEET_ID,
        kind: DailySheetKind.ROUTE,
        date: SHEET_DATE,
        driverId: DRIVER_ID,
        crew: [{ userId: 'loader-001', role: CrewRole.LOADER }],
      },
      ACTOR.userId,
      undefined,
    );

    expect(mockAudit.log).toHaveBeenCalledTimes(1);
    expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CONFIRM_CREW' }));
    expect(result.crewConfirmed).toBe(true);
  });

  it('threads absentUserIds through to captureForConfirmedCrew unchanged', async () => {
    await service.confirmCrew(VENDOR_ID, SHEET_ID, ACTOR, ['loader-001']);

    expect(mockStaffAttendance.captureForConfirmedCrew).toHaveBeenCalledWith(
      tx,
      VENDOR_ID,
      expect.any(Object),
      ACTOR.userId,
      ['loader-001'],
    );
  });

  it('idempotent re-confirm: does NOT re-flip crewConfirmed, but STILL calls captureForConfirmedCrew, and writes NO audit log', async () => {
    mockPrisma.dailySheet.findFirst.mockResolvedValue(buildSheet({ crewConfirmed: true }));

    const result = await service.confirmCrew(VENDOR_ID, SHEET_ID, ACTOR);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.dailySheet.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SHEET_ID } }),
    );
    expect(tx.dailySheet.update).not.toHaveBeenCalled();

    // The composition guarantee this whole suite exists to protect: capture
    // still runs on the idempotent path, so a re-confirm (e.g. after a
    // swap-assignment reset crewConfirmed) reconciles attendance too.
    expect(mockStaffAttendance.captureForConfirmedCrew).toHaveBeenCalledTimes(1);

    expect(mockAudit.log).not.toHaveBeenCalled();
    expect(result.crewConfirmed).toBe(true);
  });
});
