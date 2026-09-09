import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
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

const VENDOR_ID = 'vendor-1';
const SHEET_ID = 'sheet-1';

function emptyPrisma(): any {
  return {
    dailySheet: { findFirst: jest.fn() },
    conversationMessage: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    crewCashDistributionAuditLog: { findMany: jest.fn().mockResolvedValue([]) },
    sheetDiscrepancyCaseAuditLog: { findMany: jest.fn().mockResolvedValue([]) },
    damageCaseAuditLog: { findMany: jest.fn().mockResolvedValue([]) },
    deliveryItemMoveLog: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

async function makeService(mockPrisma: any): Promise<DailySheetService> {
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
  const service = module.get<DailySheetService>(DailySheetService);
  (service as any).prisma = mockPrisma;
  return service;
}

const baseSheet = {
  id: SHEET_ID,
  crewConfirmedById: null,
  closureRequestedById: null,
  closureApprovedById: null,
  closureRejectedById: null,
  items: [{ id: 'item-1', sequence: 1, customer: { name: 'Ali Traders', customerCode: 'C-012' } }],
  loads: [{ id: 'load-1', tripNumber: 2 }],
  expenses: [{ id: 'exp-1', description: 'Ice', category: 'ICE_PURCHASED' }],
  vehicleDailyChecks: [],
};

describe('DailySheetService.getSheetAuditLog', () => {
  it('throws NotFound when the sheet is not in the caller vendor', async () => {
    const prisma = emptyPrisma();
    prisma.dailySheet.findFirst.mockResolvedValue(null);
    const svc = await makeService(prisma);
    await expect(svc.getSheetAuditLog(VENDOR_ID, SHEET_ID)).rejects.toThrow(NotFoundException);
  });

  it('unions AuditLog + CrewCash + MoveLog, resolves actors, normalizes and sorts newest-first', async () => {
    const prisma = emptyPrisma();
    prisma.dailySheet.findFirst.mockResolvedValue(baseSheet);
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'a1',
        action: 'DELIVERY_VOIDED',
        entity: 'DailySheetItem',
        entityId: 'item-1',
        userId: 'u-staff',
        userName: 'Stale Name',
        createdAt: new Date('2026-09-01T10:00:00Z'),
        changes: { before: { cashCollected: 500 }, after: { voidReason: 'DUPLICATE', voidNote: 'entered twice' } },
      },
    ]);
    prisma.crewCashDistributionAuditLog.findMany.mockResolvedValue([
      {
        id: 'c1',
        action: 'CORRECTED',
        crewCashDistributionId: 'cc-1',
        actorId: 'u-admin',
        actor: { id: 'u-admin', name: 'Admin', role: 'VENDOR_ADMIN' },
        actorRole: 'VENDOR_ADMIN',
        beforeJson: { amount: 100 },
        afterJson: { amount: 150 },
        reason: 'wrong amount',
        createdAt: new Date('2026-09-02T09:00:00Z'),
      },
    ]);
    prisma.deliveryItemMoveLog.findMany.mockResolvedValue([
      {
        id: 'm1',
        itemId: 'item-9',
        fromSheetId: SHEET_ID,
        toSheetId: 'sheet-2',
        movedById: 'u-mgr',
        movedBy: { id: 'u-mgr', name: 'Manager', role: 'STAFF' },
        customer: { name: 'Bilal Store', customerCode: 'C-030' },
        movedAt: new Date('2026-08-31T08:00:00Z'),
      },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-staff', name: 'Real Staff', role: 'STAFF' }]);

    const svc = await makeService(prisma);
    const log = await svc.getSheetAuditLog(VENDOR_ID, SHEET_ID);

    expect(log.map((e) => e.id)).toEqual(['c1', 'a1', 'm1']); // newest first

    const voided = log.find((e) => e.id === 'a1')!;
    expect(voided.actionLabel).toBe('Delivery voided');
    expect(voided.category).toBe('VOID');
    expect(voided.entity).toBe('Delivery');
    expect(voided.entityLabel).toBe('Ali Traders (C-012)');
    expect(voided.actorName).toBe('Real Staff'); // resolved from users, not the stale userName
    expect(voided.reason).toBe('entered twice');

    const crew = log.find((e) => e.id === 'c1')!;
    expect(crew.actionLabel).toBe('Crew cash corrected (closed sheet)');
    expect(crew.category).toBe('CORRECTION');
    expect(crew.actorName).toBe('Admin');
    expect(crew.reason).toBe('wrong amount');

    const move = log.find((e) => e.id === 'm1')!;
    expect(move.action).toBe('DELIVERY_MOVED_OUT');
    expect(move.category).toBe('MOVE');
    expect(move.entityLabel).toBe('Bilal Store (C-030)');
  });

  it('recovers the actor for a userId-less CLOSE-family row from the sheet closure columns', async () => {
    const prisma = emptyPrisma();
    prisma.dailySheet.findFirst.mockResolvedValue({ ...baseSheet, closureApprovedById: 'u-approver' });
    prisma.auditLog.findMany.mockResolvedValue([
      { id: 'a2', action: 'APPROVE_CLOSE', entity: 'DailySheet', entityId: SHEET_ID, userId: null, userName: null, createdAt: new Date('2026-09-03T10:00:00Z'), changes: null },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-approver', name: 'Closer', role: 'STAFF' }]);

    const svc = await makeService(prisma);
    const [entry] = await svc.getSheetAuditLog(VENDOR_ID, SHEET_ID);
    expect(entry.actionLabel).toBe('Close approved');
    expect(entry.actorId).toBe('u-approver');
    expect(entry.actorName).toBe('Closer');
  });

  it('synthesizes vehicle-check entries (recorded + odometer correction with reason)', async () => {
    const prisma = emptyPrisma();
    prisma.dailySheet.findFirst.mockResolvedValue({
      ...baseSheet,
      vehicleDailyChecks: [
        {
          id: 'vdc-1',
          checkType: 'START',
          odometerReading: 45210,
          originalOdometerReading: 45010,
          recordedById: 'u-driver',
          recordedAt: new Date('2026-09-01T05:00:00Z'),
          odometerEditedById: 'u-staff',
          odometerEditedAt: new Date('2026-09-01T06:00:00Z'),
          odometerEditReason: 'typo — was 45010',
          criticalOverrideById: null,
          criticalOverrideAt: null,
          criticalOverrideNote: null,
        },
      ],
    });
    prisma.user.findMany.mockResolvedValue([
      { id: 'u-driver', name: 'Driver', role: 'DRIVER' },
      { id: 'u-staff', name: 'Staff', role: 'STAFF' },
    ]);

    const svc = await makeService(prisma);
    const log = await svc.getSheetAuditLog(VENDOR_ID, SHEET_ID);

    const rec = log.find((e) => e.action === 'VEHICLE_CHECK_RECORDED')!;
    expect(rec.source).toBe('VEHICLE_CHECK');
    expect(rec.actorName).toBe('Driver');
    expect(rec.after).toEqual({ checkType: 'START', odometerReading: 45210 });

    const corr = log.find((e) => e.action === 'VEHICLE_ODOMETER_CORRECTED')!;
    expect(corr.category).toBe('CORRECTION');
    expect(corr.before).toEqual({ odometerReading: 45010 });
    expect(corr.after).toEqual({ odometerReading: 45210 });
    expect(corr.reason).toBe('typo — was 45010');
    expect(corr.actorName).toBe('Staff');
  });
});
