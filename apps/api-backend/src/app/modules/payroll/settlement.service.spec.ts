import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { PayrollAuditAction, PayrollEntryStatus, SettlementMethod } from '@prisma/client';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const ENTRY_ID = 'entry-001';
const EMPLOYEE_ID = 'employee-001';

const adminUser = { userId: 'admin-001', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN' } as any;

function makeLockedEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    vendorId: VENDOR_ID,
    userId: EMPLOYEE_ID,
    status: PayrollEntryStatus.LOCKED,
    finalPayable: 30000,
    version: 1,
    ...overrides,
  };
}

const recordDto = { amount: 10000, method: SettlementMethod.CASH, referenceNote: 'partial payment' };

// ─── mock tx / prisma factory ─────────────────────────────────────────────────

function makeTx(overrides: any = {}) {
  return {
    payrollEntry: {
      findFirst: jest.fn().mockResolvedValue(makeLockedEntry()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
    },
    settlement: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'settlement-001', ...data })),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    },
    payrollEntryAuditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-001' }) },
    ...overrides,
  };
}

function makeService(opts: { txOverrides?: any; canViewAll?: boolean } = {}) {
  const tx = makeTx(opts.txOverrides);
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    payrollEntry: { findFirst: jest.fn().mockResolvedValue(makeLockedEntry()) },
    settlement: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const permissions = { can: jest.fn().mockResolvedValue(opts.canViewAll ?? true) };
  const svc = new SettlementService(prisma as any, permissions as any);
  return { svc, prisma, tx, permissions };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('SettlementService', () => {
  describe('record() — status precondition', () => {
    it.each([PayrollEntryStatus.DRAFT, PayrollEntryStatus.UNDER_REVIEW, PayrollEntryStatus.APPROVED])(
      'rejects recording a settlement against a %s entry, naming the actual status',
      async (status) => {
        const { svc, tx } = makeService({ txOverrides: { payrollEntry: { ...makeTx().payrollEntry, findFirst: jest.fn().mockResolvedValue(makeLockedEntry({ status })) } } });
        await expect(svc.record(adminUser, ENTRY_ID, recordDto)).rejects.toThrow(BadRequestException);
        await expect(svc.record(adminUser, ENTRY_ID, recordDto)).rejects.toThrow(new RegExp(status));
        expect(tx.settlement.create).not.toHaveBeenCalled();
      },
    );

    it('throws NotFoundException when the entry does not belong to this vendor (tenancy)', async () => {
      const { svc } = makeService({
        txOverrides: { payrollEntry: { ...makeTx().payrollEntry, findFirst: jest.fn().mockResolvedValue(null) } },
      });
      await expect(svc.record(adminUser, ENTRY_ID, recordDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('record() — partial payment does not auto-settle', () => {
    it('creates the settlement but leaves a LOCKED entry LOCKED when cumulative < finalPayable', async () => {
      const { svc, tx } = makeService({
        txOverrides: { settlement: { ...makeTx().settlement, aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 10000 } }) } },
      });

      const result = await svc.record(adminUser, ENTRY_ID, recordDto);

      expect(tx.settlement.create).toHaveBeenCalledTimes(1);
      expect(tx.payrollEntry.updateMany).not.toHaveBeenCalled();
      expect(result.autoSettled).toBe(false);
      expect(result.entry.status).toBe(PayrollEntryStatus.LOCKED);
      expect(tx.payrollEntryAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: PayrollAuditAction.SETTLED }) }),
      );
    });
  });

  describe('record() — cumulative payment reaching finalPayable auto-settles', () => {
    it('transitions a LOCKED entry to SETTLED via CAS when cumulative >= finalPayable', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          settlement: { ...makeTx().settlement, aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 30000 } }) },
          payrollEntry: {
            ...makeTx().payrollEntry,
            findUniqueOrThrow: jest.fn().mockResolvedValue(makeLockedEntry({ status: PayrollEntryStatus.SETTLED, version: 2 })),
          },
        },
      });

      const result = await svc.record(adminUser, ENTRY_ID, recordDto);

      expect(tx.payrollEntry.updateMany).toHaveBeenCalledWith({
        where: { id: ENTRY_ID, vendorId: VENDOR_ID, version: 1 },
        data: { status: PayrollEntryStatus.SETTLED, version: { increment: 1 } },
      });
      expect(result.autoSettled).toBe(true);
      expect(result.entry.status).toBe(PayrollEntryStatus.SETTLED);
    });

    it('throws ConflictException when the CAS loses the race (version already moved on)', async () => {
      const { svc } = makeService({
        txOverrides: {
          settlement: { ...makeTx().settlement, aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 30000 } }) },
          payrollEntry: { ...makeTx().payrollEntry, updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        },
      });
      await expect(svc.record(adminUser, ENTRY_ID, recordDto)).rejects.toThrow(ConflictException);
    });

    it('does not re-trigger a status transition when the entry is already SETTLED (additional installment)', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          payrollEntry: { ...makeTx().payrollEntry, findFirst: jest.fn().mockResolvedValue(makeLockedEntry({ status: PayrollEntryStatus.SETTLED })) },
          settlement: { ...makeTx().settlement, aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 40000 } }) },
        },
      });

      const result = await svc.record(adminUser, ENTRY_ID, recordDto);

      expect(tx.payrollEntry.updateMany).not.toHaveBeenCalled();
      expect(result.autoSettled).toBe(false);
      expect(result.entry.status).toBe(PayrollEntryStatus.SETTLED);
    });

    it('never auto-settles when finalPayable <= 0, no matter how much is settled', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          payrollEntry: { ...makeTx().payrollEntry, findFirst: jest.fn().mockResolvedValue(makeLockedEntry({ finalPayable: 0 })) },
          settlement: { ...makeTx().settlement, aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 5000 } }) },
        },
      });

      const result = await svc.record(adminUser, ENTRY_ID, recordDto);

      expect(tx.payrollEntry.updateMany).not.toHaveBeenCalled();
      expect(result.autoSettled).toBe(false);
    });
  });

  describe('markSettled() — finalPayable <= 0 closes out without any settlement rows', () => {
    it('transitions LOCKED -> SETTLED with zero settlements created', async () => {
      const { svc, tx } = makeService({
        txOverrides: {
          payrollEntry: {
            ...makeTx().payrollEntry,
            findFirst: jest.fn().mockResolvedValue(makeLockedEntry({ finalPayable: 0 })),
            findUniqueOrThrow: jest.fn().mockResolvedValue(makeLockedEntry({ finalPayable: 0, status: PayrollEntryStatus.SETTLED, version: 2 })),
          },
        },
      });

      const updated = await svc.markSettled(adminUser, ENTRY_ID, 1);

      expect(tx.settlement.create).not.toHaveBeenCalled();
      expect(tx.payrollEntry.updateMany).toHaveBeenCalledWith({
        where: { id: ENTRY_ID, vendorId: VENDOR_ID, version: 1 },
        data: { status: PayrollEntryStatus.SETTLED, version: { increment: 1 } },
      });
      expect(updated).toBeDefined();
    });
  });

  describe('markSettled() — status precondition', () => {
    it('rejects marking a non-LOCKED entry settled', async () => {
      const { svc } = makeService({
        txOverrides: {
          payrollEntry: { ...makeTx().payrollEntry, findFirst: jest.fn().mockResolvedValue(makeLockedEntry({ status: PayrollEntryStatus.DRAFT })) },
        },
      });
      await expect(svc.markSettled(adminUser, ENTRY_ID, 1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('markSettled() — version conflict', () => {
    it('throws ConflictException on stale version', async () => {
      const { svc } = makeService({
        txOverrides: { payrollEntry: { ...makeTx().payrollEntry, updateMany: jest.fn().mockResolvedValue({ count: 0 }) } },
      });
      await expect(svc.markSettled(adminUser, ENTRY_ID, 99)).rejects.toThrow(ConflictException);
    });
  });

  describe('markSettled() — tenancy isolation', () => {
    it('throws NotFoundException when the entry does not belong to this vendor', async () => {
      const { svc } = makeService({
        txOverrides: { payrollEntry: { ...makeTx().payrollEntry, findFirst: jest.fn().mockResolvedValue(null) } },
      });
      await expect(svc.markSettled(adminUser, ENTRY_ID, 1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('listForEntry()', () => {
    it('returns settlements and a positive remainingBalance when underpaid', async () => {
      const { svc, prisma } = makeService();
      prisma.payrollEntry.findFirst.mockResolvedValue(makeLockedEntry({ finalPayable: 30000 }));
      prisma.settlement.findMany.mockResolvedValue([{ id: 's1', amount: 10000 }]);

      const result = await svc.listForEntry(adminUser, ENTRY_ID);
      expect(result.remainingBalance).toBe(20000);
      expect(result.settlements).toHaveLength(1);
    });

    it('returns a negative remainingBalance when overpaid', async () => {
      const { svc, prisma } = makeService();
      prisma.payrollEntry.findFirst.mockResolvedValue(makeLockedEntry({ finalPayable: 1000 }));
      prisma.settlement.findMany.mockResolvedValue([{ id: 's1', amount: 900 }, { id: 's2', amount: 600 }]);

      const result = await svc.listForEntry(adminUser, ENTRY_ID);
      expect(result.remainingBalance).toBe(-500);
    });

    it('throws NotFoundException when the entry does not belong to this vendor (tenancy)', async () => {
      const { svc, prisma } = makeService();
      prisma.payrollEntry.findFirst.mockResolvedValue(null);
      await expect(svc.listForEntry(adminUser, ENTRY_ID)).rejects.toThrow(NotFoundException);
    });

    it('allows a user to view their own entry\'s settlements with no payroll:view_all permission', async () => {
      const { svc, prisma, permissions } = makeService({ canViewAll: false });
      prisma.payrollEntry.findFirst.mockResolvedValue(makeLockedEntry());
      const self = { userId: EMPLOYEE_ID, vendorId: VENDOR_ID, role: 'DRIVER' } as any;

      await expect(svc.listForEntry(self, ENTRY_ID)).resolves.toBeDefined();
      expect(permissions.can).not.toHaveBeenCalled();
    });

    it('rejects viewing another employee\'s settlements without payroll:view_all', async () => {
      const { svc, prisma } = makeService({ canViewAll: false });
      prisma.payrollEntry.findFirst.mockResolvedValue(makeLockedEntry());
      const otherStaffUser = { userId: 'staff-002', vendorId: VENDOR_ID, role: 'STAFF' } as any;

      await expect(svc.listForEntry(otherStaffUser, ENTRY_ID)).rejects.toThrow(ForbiddenException);
    });

    it('allows viewing another employee\'s settlements with payroll:view_all', async () => {
      const { svc, prisma } = makeService({ canViewAll: true });
      prisma.payrollEntry.findFirst.mockResolvedValue(makeLockedEntry());
      const otherStaffUser = { userId: 'staff-002', vendorId: VENDOR_ID, role: 'STAFF' } as any;

      await expect(svc.listForEntry(otherStaffUser, ENTRY_ID)).resolves.toBeDefined();
    });
  });
});
