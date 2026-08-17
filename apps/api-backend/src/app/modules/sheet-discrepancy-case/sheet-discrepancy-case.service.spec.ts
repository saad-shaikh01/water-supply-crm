import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SheetDiscrepancyCaseService } from './sheet-discrepancy-case.service';
import {
  DiscrepancyType,
  DiscrepancyResolutionType,
  DiscrepancyCaseStatus,
  UserRole,
  StaffLedgerCategory,
  ExpenseCategory,
} from '@prisma/client';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const SHEET_ID = 'sheet-001';
const DRIVER_ID = 'driver-001';
const ACTOR_ID = 'admin-001';
const CASE_ID = 'case-001';

const adminUser = { userId: ACTOR_ID, vendorId: VENDOR_ID, role: 'VENDOR_ADMIN', name: 'Admin' } as any;

const baseCase = {
  id: CASE_ID,
  vendorId: VENDOR_ID,
  driverId: DRIVER_ID,
  dailySheetId: SHEET_ID,
  type: DiscrepancyType.CASH,
  status: DiscrepancyCaseStatus.REPORTED,
  version: 0,
};

// ─── mock tx / service factory ──────────────────────────────────────────────

function makeTx() {
  return {
    sheetDiscrepancyCase: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'new-case-001', version: 0, status: 'REPORTED', ...data })),
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: CASE_ID, status: 'RESOLVED' }),
    },
    sheetDiscrepancyCaseAuditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    expense: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'expense-001', ...data })),
    },
  };
}

function makeService(opts: { staffLedgerCreateTx?: jest.Mock } = {}) {
  const tx = makeTx();
  const staffLedger = { createTx: opts.staffLedgerCreateTx ?? jest.fn().mockResolvedValue({ id: 'ledger-001' }) };
  const prisma = { $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)) };

  const svc = new SheetDiscrepancyCaseService(prisma as any, staffLedger as any);
  return { svc, prisma, tx, staffLedger };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('SheetDiscrepancyCaseService', () => {
  describe('createCasesForSheet()', () => {
    it('creates one case per non-zero discrepancy type (bottle, empty, cash)', async () => {
      const { svc, tx } = makeService();
      const reconciliation = {
        bottles: { discrepancy: 5 },
        empties: { discrepancy: -2 },
        driver: { unexplainedDiscrepancy: 100 },
      };

      const result = await svc.createCasesForSheet(
        tx as any, VENDOR_ID, { id: SHEET_ID, driverId: DRIVER_ID }, reconciliation, ACTOR_ID, UserRole.VENDOR_ADMIN,
      );

      expect(result.createdCount).toBe(3);
      expect(result.types).toEqual([DiscrepancyType.BOTTLE, DiscrepancyType.EMPTY, DiscrepancyType.CASH]);
      expect(tx.sheetDiscrepancyCase.create).toHaveBeenCalledTimes(3);
      expect(tx.sheetDiscrepancyCaseAuditLog.create).toHaveBeenCalledTimes(3);
    });

    it('creates a case for a single-unit gap — no auto-waive threshold', async () => {
      const { svc, tx } = makeService();
      const reconciliation = { bottles: { discrepancy: 1 }, empties: { discrepancy: 0 }, driver: { unexplainedDiscrepancy: 0 } };

      const result = await svc.createCasesForSheet(
        tx as any, VENDOR_ID, { id: SHEET_ID, driverId: DRIVER_ID }, reconciliation, ACTOR_ID, UserRole.VENDOR_ADMIN,
      );

      expect(result.createdCount).toBe(1);
      expect(result.types).toEqual([DiscrepancyType.BOTTLE]);
    });

    it('skips every type with exactly zero discrepancy', async () => {
      const { svc, tx } = makeService();
      const reconciliation = { bottles: { discrepancy: 0 }, empties: { discrepancy: 0 }, driver: { unexplainedDiscrepancy: 0 } };

      const result = await svc.createCasesForSheet(
        tx as any, VENDOR_ID, { id: SHEET_ID, driverId: DRIVER_ID }, reconciliation, ACTOR_ID, UserRole.VENDOR_ADMIN,
      );

      expect(result.createdCount).toBe(0);
      expect(tx.sheetDiscrepancyCase.create).not.toHaveBeenCalled();
      expect(tx.sheetDiscrepancyCaseAuditLog.create).not.toHaveBeenCalled();
    });

    it('splits reportedQuantity/reportedAmount correctly by type — BOTTLE/EMPTY get a count, CASH gets a rupee amount', async () => {
      const { svc, tx } = makeService();
      const reconciliation = { bottles: { discrepancy: 5 }, empties: { discrepancy: 0 }, driver: { unexplainedDiscrepancy: 250 } };

      await svc.createCasesForSheet(
        tx as any, VENDOR_ID, { id: SHEET_ID, driverId: DRIVER_ID }, reconciliation, ACTOR_ID, UserRole.VENDOR_ADMIN,
      );

      expect(tx.sheetDiscrepancyCase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: DiscrepancyType.BOTTLE, reportedQuantity: 5, reportedAmount: null }),
        }),
      );
      expect(tx.sheetDiscrepancyCase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: DiscrepancyType.CASH, reportedQuantity: null, reportedAmount: 250 }),
        }),
      );
    });

    it('scopes every created row to the given vendorId/dailySheetId/driverId', async () => {
      const { svc, tx } = makeService();
      const reconciliation = { bottles: { discrepancy: 3 }, empties: { discrepancy: 0 }, driver: { unexplainedDiscrepancy: 0 } };

      await svc.createCasesForSheet(
        tx as any, VENDOR_ID, { id: SHEET_ID, driverId: DRIVER_ID }, reconciliation, ACTOR_ID, UserRole.VENDOR_ADMIN,
      );

      expect(tx.sheetDiscrepancyCase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ vendorId: VENDOR_ID, dailySheetId: SHEET_ID, driverId: DRIVER_ID }),
        }),
      );
    });
  });

  describe('resolve()', () => {
    it('CHARGED_TO_DRIVER calls StaffLedgerService.createTx with PENALTY category and a negative rounded integer amount', async () => {
      const staffLedgerCreateTx = jest.fn().mockResolvedValue({ id: 'ledger-001' });
      const { svc, tx } = makeService({ staffLedgerCreateTx });
      tx.sheetDiscrepancyCase.findFirst.mockResolvedValue(baseCase);

      await svc.resolve(adminUser, CASE_ID, {
        resolutionType: DiscrepancyResolutionType.CHARGED_TO_DRIVER,
        resolutionAmount: 250.6,
        version: 0,
      });

      expect(staffLedgerCreateTx).toHaveBeenCalledWith(
        tx,
        adminUser,
        expect.objectContaining({ userId: DRIVER_ID, category: StaffLedgerCategory.PENALTY, amount: -251 }),
      );
      expect(tx.expense.create).not.toHaveBeenCalled();
    });

    it('COMPANY_LOSS creates a raw Expense row (category DISCREPANCY_WRITE_OFF, paidFromCash false) and skips the ledger', async () => {
      const { svc, tx, staffLedger } = makeService();
      tx.sheetDiscrepancyCase.findFirst.mockResolvedValue(baseCase);

      await svc.resolve(adminUser, CASE_ID, {
        resolutionType: DiscrepancyResolutionType.COMPANY_LOSS,
        resolutionAmount: 300,
        version: 0,
      });

      expect(tx.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            category: ExpenseCategory.DISCREPANCY_WRITE_OFF,
            amount: 300,
            paidFromCash: false,
            dailySheetId: SHEET_ID,
          }),
        }),
      );
      expect(staffLedger.createTx).not.toHaveBeenCalled();
    });

    it('WAIVED without a resolutionNote is rejected before the transaction even opens', async () => {
      const { svc, prisma } = makeService();

      await expect(
        svc.resolve(adminUser, CASE_ID, { resolutionType: DiscrepancyResolutionType.WAIVED, version: 0 }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('WAIVED with a reason moves no money at all', async () => {
      const { svc, tx, staffLedger } = makeService();
      tx.sheetDiscrepancyCase.findFirst.mockResolvedValue(baseCase);

      await svc.resolve(adminUser, CASE_ID, {
        resolutionType: DiscrepancyResolutionType.WAIVED,
        resolutionNote: 'rounding noise, accepted',
        version: 0,
      });

      expect(staffLedger.createTx).not.toHaveBeenCalled();
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.sheetDiscrepancyCase.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ resolutionAmount: null }) }),
      );
    });

    it('rejects resolving a case that is not REPORTED', async () => {
      const { svc, tx } = makeService();
      tx.sheetDiscrepancyCase.findFirst.mockResolvedValue({ ...baseCase, status: DiscrepancyCaseStatus.RESOLVED });

      await expect(
        svc.resolve(adminUser, CASE_ID, { resolutionType: DiscrepancyResolutionType.WAIVED, resolutionNote: 'x', version: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the case does not belong to this vendor', async () => {
      const { svc, tx } = makeService();
      tx.sheetDiscrepancyCase.findFirst.mockResolvedValue(null);

      await expect(
        svc.resolve(adminUser, CASE_ID, { resolutionType: DiscrepancyResolutionType.WAIVED, resolutionNote: 'x', version: 0 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('version-mismatch CAS throws ConflictException — the atomic updateMany where-clause is the real guard', async () => {
      const { svc, tx } = makeService();
      tx.sheetDiscrepancyCase.findFirst.mockResolvedValue(baseCase);
      tx.sheetDiscrepancyCase.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        svc.resolve(adminUser, CASE_ID, { resolutionType: DiscrepancyResolutionType.CHARGED_TO_DRIVER, resolutionAmount: 250, version: 99 }),
      ).rejects.toThrow(ConflictException);

      expect(tx.sheetDiscrepancyCase.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: CASE_ID, vendorId: VENDOR_ID, version: 99 } }),
      );
      // The whole $transaction callback throws past the CAS check, so a real
      // Prisma client rolls back the StaffLedgerEntry insert issued above it
      // in the same callback too — no orphaned row.
    });

    it('writes a RESOLVED audit log entry with the resolution payload', async () => {
      const { svc, tx } = makeService();
      tx.sheetDiscrepancyCase.findFirst.mockResolvedValue(baseCase);

      await svc.resolve(adminUser, CASE_ID, {
        resolutionType: DiscrepancyResolutionType.WAIVED,
        resolutionNote: 'accepted',
        version: 0,
      });

      expect(tx.sheetDiscrepancyCaseAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            discrepancyCaseId: CASE_ID,
            actorId: ACTOR_ID,
            actorRole: adminUser.role,
            action: 'RESOLVED',
          }),
        }),
      );
    });
  });
});
