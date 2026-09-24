import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SalaryStructureService } from './salary-structure.service';
import { PayFrequency } from '@prisma/client';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const EMPLOYEE_ID = 'employee-001';

const adminUser = { userId: 'admin-001', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN', name: 'Admin One' } as any;
const otherStaffUser = { userId: 'staff-002', vendorId: VENDOR_ID, role: 'STAFF' } as any;

const currentStructure = {
  id: 'structure-001',
  vendorId: VENDOR_ID,
  userId: EMPLOYEE_ID,
  baseAmount: 30000,
  payFrequency: PayFrequency.MONTHLY,
  effectiveFrom: new Date('2026-01-01'),
  effectiveTo: null,
  voidedAt: null,
};

function makeService(userExists = true, canViewAll = true) {
  const tx = {
    salaryStructure: {
      findFirst: jest.fn().mockResolvedValue(null), // no previous structure by default
      update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'new-structure-001', ...data })),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-001' }) },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    user: { findFirst: jest.fn().mockResolvedValue(userExists ? { id: EMPLOYEE_ID } : null) },
    salaryStructure: {
      findMany: jest.fn().mockResolvedValue([currentStructure]),
      findFirst: jest.fn().mockResolvedValue(currentStructure),
    },
  };
  const permissions = { can: jest.fn().mockResolvedValue(canViewAll) };

  const svc = new SalaryStructureService(prisma as any, permissions as any);
  return { svc, prisma, tx, permissions };
}

describe('SalaryStructureService', () => {
  describe('create()', () => {
    const createDto = { userId: EMPLOYEE_ID, baseAmount: 35000, effectiveFrom: '2026-09-01' };

    it('creates a new structure with no previous row to close', async () => {
      const { svc, tx } = makeService();
      const result = await svc.create(adminUser, createDto as any);
      expect(result.baseAmount).toBe(35000);
      expect(tx.salaryStructure.update).not.toHaveBeenCalled();
      expect(tx.salaryStructure.create).toHaveBeenCalled();
    });

    it('closes the previous open-ended row before creating the new one', async () => {
      const { svc, tx } = makeService();
      tx.salaryStructure.findFirst.mockResolvedValue(currentStructure);
      await svc.create(adminUser, { ...createDto, effectiveFrom: '2026-09-01' } as any);
      expect(tx.salaryStructure.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: currentStructure.id } }),
      );
    });

    it('rejects a new effectiveFrom that does not come after the current row\'s', async () => {
      const { svc, tx } = makeService();
      tx.salaryStructure.findFirst.mockResolvedValue(currentStructure);
      await expect(
        svc.create(adminUser, { ...createDto, effectiveFrom: '2025-12-01' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the employee does not belong to this vendor', async () => {
      const { svc } = makeService(false);
      await expect(svc.create(adminUser, createDto as any)).rejects.toThrow(NotFoundException);
    });
  });

  // ── self-view-only scoping (payroll:view_all) ─────────────────────────────

  describe('listHistory() self-view scoping', () => {
    it('allows a user to view their own history with no payroll:view_all permission', async () => {
      const { svc, permissions } = makeService(true, false);
      const self = { userId: EMPLOYEE_ID, vendorId: VENDOR_ID, role: 'DRIVER' } as any;
      await expect(svc.listHistory(self, EMPLOYEE_ID)).resolves.toBeDefined();
      expect(permissions.can).not.toHaveBeenCalled();
    });

    it('rejects viewing another employee\'s history without payroll:view_all', async () => {
      const { svc } = makeService(true, false);
      await expect(svc.listHistory(otherStaffUser, EMPLOYEE_ID)).rejects.toThrow(ForbiddenException);
    });

    it('allows viewing another employee\'s history with payroll:view_all', async () => {
      const { svc } = makeService(true, true);
      await expect(svc.listHistory(otherStaffUser, EMPLOYEE_ID)).resolves.toBeDefined();
    });
  });

  describe('getEffectiveOn() self-view scoping', () => {
    it('allows a user to view their own effective structure with no payroll:view_all permission', async () => {
      const { svc, permissions } = makeService(true, false);
      const self = { userId: EMPLOYEE_ID, vendorId: VENDOR_ID, role: 'DRIVER' } as any;
      await expect(svc.getEffectiveOn(self, EMPLOYEE_ID)).resolves.toBeDefined();
      expect(permissions.can).not.toHaveBeenCalled();
    });

    it('rejects viewing another employee\'s effective structure without payroll:view_all', async () => {
      const { svc } = makeService(true, false);
      await expect(svc.getEffectiveOn(otherStaffUser, EMPLOYEE_ID)).rejects.toThrow(ForbiddenException);
    });

    it('allows viewing another employee\'s effective structure with payroll:view_all', async () => {
      const { svc } = makeService(true, true);
      await expect(svc.getEffectiveOn(otherStaffUser, EMPLOYEE_ID)).resolves.toBeDefined();
    });
  });

  describe('voidCurrentRow()', () => {
    const voidDto = { voidReason: 'Wrong amount entered — should have been 50000 effective 2026-09-01.' };
    const rowToVoid = { ...currentStructure, id: 'structure-002', effectiveFrom: new Date('2026-09-14'), effectiveTo: null };
    const predecessor = { ...currentStructure, id: 'structure-001', effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-09-13') };

    it('voids the current row and reopens the predecessor it had trimmed', async () => {
      const { svc, tx } = makeService();
      tx.salaryStructure.findFirst
        .mockResolvedValueOnce(rowToVoid) // the row itself
        .mockResolvedValueOnce(null) // no later row
        .mockResolvedValueOnce(predecessor); // predecessor to reopen

      const result = await svc.voidCurrentRow(adminUser, rowToVoid.id, voidDto as any);

      expect(tx.salaryStructure.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: predecessor.id }, data: { effectiveTo: null } }),
      );
      expect(tx.salaryStructure.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: rowToVoid.id },
          data: expect.objectContaining({ voidedById: adminUser.userId, voidReason: voidDto.voidReason }),
        }),
      );
      expect(tx.salaryStructure.update).toHaveBeenCalledTimes(2);
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ entity: 'SalaryStructure', entityId: rowToVoid.id, action: 'VOID' }),
        }),
      );
      expect(result.voidReason).toBe(voidDto.voidReason);
    });

    it('voids the first-ever row for an employee with no predecessor to reopen', async () => {
      const { svc, tx } = makeService();
      tx.salaryStructure.findFirst
        .mockResolvedValueOnce(rowToVoid)
        .mockResolvedValueOnce(null) // no later row
        .mockResolvedValueOnce(null); // no predecessor

      await svc.voidCurrentRow(adminUser, rowToVoid.id, voidDto as any);

      // Only the target row itself is updated — never a phantom predecessor reopen.
      expect(tx.salaryStructure.update).toHaveBeenCalledTimes(1);
      expect(tx.salaryStructure.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: rowToVoid.id } }),
      );
    });

    it('rejects voiding a row that is not the current (latest, open-ended) one', async () => {
      const { svc, tx } = makeService();
      tx.salaryStructure.findFirst.mockResolvedValueOnce({ ...rowToVoid, effectiveTo: new Date('2026-09-13') });

      await expect(svc.voidCurrentRow(adminUser, rowToVoid.id, voidDto as any)).rejects.toThrow(BadRequestException);
      expect(tx.salaryStructure.update).not.toHaveBeenCalled();
    });

    it('rejects when a later non-voided row exists (belt-and-suspenders)', async () => {
      const { svc, tx } = makeService();
      const laterRow = { ...rowToVoid, id: 'structure-003', effectiveFrom: new Date('2026-10-01') };
      tx.salaryStructure.findFirst
        .mockResolvedValueOnce(rowToVoid)
        .mockResolvedValueOnce(laterRow);

      await expect(svc.voidCurrentRow(adminUser, rowToVoid.id, voidDto as any)).rejects.toThrow(BadRequestException);
      expect(tx.salaryStructure.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a row outside this vendor, or already voided', async () => {
      const { svc, tx } = makeService();
      tx.salaryStructure.findFirst.mockResolvedValueOnce(null);
      await expect(svc.voidCurrentRow(adminUser, 'nope', voidDto as any)).rejects.toThrow(NotFoundException);
    });
  });
});
