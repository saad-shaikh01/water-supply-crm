import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CrewCashDistributionService } from './crew-cash-distribution.service';
import { CrewCashAuditAction, CrewCashCategory } from '@prisma/client';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const SHEET_ID = 'sheet-001';
const DRIVER_ID = 'driver-001';
const EMPLOYEE_ID = 'employee-001'; // a confirmed crew member (not the driver)
const ENTRY_ID = 'entry-001';

const salesmanUser = { userId: 'salesman-001', vendorId: VENDOR_ID, role: 'SALESMAN', name: 'Sales' } as any;
const adminUser = { userId: 'admin-001', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN', name: 'Admin' } as any;
const otherStaffUser = { userId: 'staff-002', vendorId: VENDOR_ID, role: 'STAFF', name: 'Other Staff' } as any;

const sheetOpen = { id: SHEET_ID, date: new Date('2026-08-01'), isClosed: false, driverId: DRIVER_ID };
const sheetClosed = { ...sheetOpen, isClosed: true };

// entry created by salesmanUser, pre-sync, does not require approval
const baseEntry = {
  id: ENTRY_ID,
  vendorId: VENDOR_ID,
  dailySheetId: SHEET_ID,
  distributedById: 'salesman-001',
  employeeId: EMPLOYEE_ID,
  category: CrewCashCategory.TEA,
  amount: 50,
  notes: null,
  photoKeys: [] as string[],
  date: new Date('2026-08-01'),
  requiresApproval: false,
  approvedById: null as string | null,
  approvedAt: null as Date | null,
  syncedAt: null as Date | null,
  syncedLedgerEntryId: null,
  createdById: 'salesman-001',
  version: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const syncedEntry = { ...baseEntry, syncedAt: new Date('2026-08-02') };
const approvedEntry = { ...baseEntry, requiresApproval: true, approvedAt: new Date('2026-08-01'), approvedById: 'admin-001', version: 1 };
const pendingApprovalEntry = { ...baseEntry, requiresApproval: true, version: 1 };

// ─── mock tx factory ────────────────────────────────────────────────────────
//
// Models the atomic CAS semantics of `updateMany({ where: { id, vendorId,
// version } })` exactly like StaffLedgerService's own spec: `current` tracks
// the live row across calls on this tx instance, `findFirst` returns a
// frozen pre-image (models two concurrent readers).

function makeTx(entrySnapshot: any = baseEntry) {
  let current = { ...entrySnapshot };
  // Models CrewCashDistributionAuditLog as a real table so the SET NULL
  // cascade (migration 20260806205508_crew_cash_audit_log_nullable_fk) can be
  // simulated on `crewCashDistribution.deleteMany` below, instead of a bare mock.
  const auditLogStore: any[] = [];
  let auditLogSeq = 0;

  return {
    crewCashDistribution: {
      findFirst: jest.fn().mockImplementation(async () => ({ ...entrySnapshot })),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => current),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'new-entry-001',
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        syncedAt: null,
        approvedAt: null,
        approvedById: null,
        ...data,
      })),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
        if (where.version !== current.version) return { count: 0 };
        const versionBump = data.version?.increment ?? 0;
        current = { ...current, ...data, version: current.version + versionBump };
        return { count: 1 };
      }),
      deleteMany: jest.fn().mockImplementation(async ({ where }: any) => {
        // Atomic compare-and-delete: only actually deletes (and cascades the
        // FK null-out) when the row still matches the where-clause's
        // syncedAt filter at the moment of the call — models the same race
        // window updateMany's version check models above.
        if (where.syncedAt === null && current.syncedAt !== null) return { count: 0 };
        // ON DELETE SET NULL on CrewCashDistributionAuditLog.crewCashDistributionId
        // — deleting the parent nulls the FK on every referencing audit row
        // instead of blocking the delete (RESTRICT, the pre-fix behavior) or
        // losing the row.
        for (const row of auditLogStore) {
          if (row.crewCashDistributionId === where.id) row.crewCashDistributionId = null;
        }
        return { count: 1 };
      }),
    },
    crewCashDistributionAuditLog: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const row = { id: `audit-${++auditLogSeq}`, createdAt: new Date(), ...data };
        auditLogStore.push(row);
        return row;
      }),
      findMany: jest.fn().mockImplementation(async () => [...auditLogStore]),
    },
    auditLogStore,
  };
}

// ─── service factory ────────────────────────────────────────────────────────

function makeService(
  opts: {
    entrySnapshot?: any;
    sheet?: any;
    isCrew?: boolean;
    approvalRequired?: boolean;
    canPermission?: boolean;
    employeeExists?: boolean;
    duplicateCount?: number;
  } = {},
) {
  const {
    entrySnapshot = baseEntry,
    sheet = sheetOpen,
    isCrew = true,
    approvalRequired = false,
    canPermission = true,
    employeeExists = true,
    duplicateCount = 0,
  } = opts;

  const tx = makeTx(entrySnapshot);
  tx.crewCashDistribution.count.mockResolvedValue(duplicateCount);

  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    dailySheet: { findFirst: jest.fn().mockResolvedValue(sheet) },
    dailySheetCrew: { findUnique: jest.fn().mockResolvedValue(isCrew ? { id: 'crew-row-1' } : null) },
    user: { findFirst: jest.fn().mockResolvedValue(employeeExists ? { id: EMPLOYEE_ID } : null) },
    crewCashDistribution: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const approvalGate = { requiresApproval: jest.fn().mockResolvedValue(approvalRequired) };
  const permissions = { can: jest.fn().mockResolvedValue(canPermission) };

  const svc = new CrewCashDistributionService(prisma as any, approvalGate as any, permissions as any);
  return { svc, prisma, tx, approvalGate, permissions };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('CrewCashDistributionService', () => {
  const createDto = { employeeId: EMPLOYEE_ID, category: CrewCashCategory.TEA, amount: 50 };

  describe('create()', () => {
    it('creates an entry for a confirmed crew member', async () => {
      const { svc, tx } = makeService();
      const entry = await svc.create(salesmanUser, SHEET_ID, createDto);
      expect(entry.employeeId).toBe(EMPLOYEE_ID);
      expect(tx.crewCashDistribution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dailySheetId: SHEET_ID,
            distributedById: salesmanUser.userId,
            createdById: salesmanUser.userId,
            date: sheetOpen.date,
          }),
        }),
      );
    });

    it('allows the sheet driver as employeeId without a DailySheetCrew lookup', async () => {
      const { svc, prisma } = makeService();
      await svc.create(salesmanUser, SHEET_ID, { ...createDto, employeeId: DRIVER_ID });
      expect(prisma.dailySheetCrew.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an employeeId not on the confirmed crew for this sheet', async () => {
      const { svc } = makeService({ isCrew: false });
      await expect(svc.create(salesmanUser, SHEET_ID, createDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects creating against a closed daily sheet', async () => {
      const { svc } = makeService({ sheet: sheetClosed });
      await expect(svc.create(salesmanUser, SHEET_ID, createDto)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the sheet does not belong to this vendor', async () => {
      const { svc } = makeService({ sheet: null });
      await expect(svc.create(salesmanUser, SHEET_ID, createDto)).rejects.toThrow(NotFoundException);
    });

    it('snapshots requiresApproval=true when the approval gate trips', async () => {
      const { svc } = makeService({ approvalRequired: true });
      const entry = await svc.create(salesmanUser, SHEET_ID, createDto);
      expect(entry.requiresApproval).toBe(true);
    });

    it('snapshots requiresApproval=false when the approval gate does not trip', async () => {
      const { svc } = makeService({ approvalRequired: false });
      const entry = await svc.create(salesmanUser, SHEET_ID, createDto);
      expect(entry.requiresApproval).toBe(false);
    });

    it('writes a CREATED audit log entry inside the same transaction', async () => {
      const { svc, tx, prisma } = makeService();
      await svc.create(salesmanUser, SHEET_ID, createDto);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.crewCashDistributionAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: CrewCashAuditAction.CREATED }) }),
      );
    });

    it('flags possibleDuplicate=true without blocking creation', async () => {
      const { svc, tx } = makeService({ duplicateCount: 1 });
      const entry = await svc.create(salesmanUser, SHEET_ID, createDto);
      expect(entry.possibleDuplicate).toBe(true);
      expect(tx.crewCashDistribution.create).toHaveBeenCalled();
    });

    it('flags possibleDuplicate=false when no recent match exists', async () => {
      const { svc } = makeService({ duplicateCount: 0 });
      const entry = await svc.create(salesmanUser, SHEET_ID, createDto);
      expect(entry.possibleDuplicate).toBe(false);
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('edits category/amount/notes/photoKeys', async () => {
      const { svc, tx } = makeService();
      const result = await svc.update(salesmanUser, ENTRY_ID, { version: 0, amount: 100, notes: 'fixed typo' });
      expect(result.amount).toBe(100);
      expect(tx.crewCashDistribution.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ENTRY_ID, vendorId: VENDOR_ID, version: 0 } }),
      );
    });

    it('rejects editing an entry already synced into the Payroll Ledger', async () => {
      const { svc } = makeService({ entrySnapshot: syncedEntry });
      await expect(svc.update(salesmanUser, ENTRY_ID, { version: 0, amount: 100 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("allows the entry's own creator to edit without crew_cash:edit", async () => {
      const { svc } = makeService({ canPermission: false });
      const result = await svc.update(salesmanUser, ENTRY_ID, { version: 0, amount: 75 });
      expect(result.amount).toBe(75);
    });

    it('rejects a non-creator without crew_cash:edit', async () => {
      const { svc } = makeService({ canPermission: false });
      await expect(svc.update(otherStaffUser, ENTRY_ID, { version: 0, amount: 75 })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows a crew_cash:edit holder to edit an entry they did not create', async () => {
      const { svc, permissions } = makeService({ canPermission: true });
      const result = await svc.update(otherStaffUser, ENTRY_ID, { version: 0, amount: 75 });
      expect(result.amount).toBe(75);
      expect(permissions.can).toHaveBeenCalledWith(otherStaffUser.userId, 'crew_cash:edit');
    });

    it('throws ConflictException on stale version', async () => {
      const { svc } = makeService();
      await expect(svc.update(salesmanUser, ENTRY_ID, { version: 99, amount: 75 })).rejects.toThrow(
        ConflictException,
      );
    });

    it('re-evaluates requiresApproval when the amount changes and crosses the threshold', async () => {
      const { svc, approvalGate } = makeService({ approvalRequired: true });
      const result = await svc.update(salesmanUser, ENTRY_ID, { version: 0, amount: 5000 });
      expect(approvalGate.requiresApproval).toHaveBeenCalledWith(VENDOR_ID, 'CREW_CASH_TEA', 5000);
      expect(result.requiresApproval).toBe(true);
    });

    it('does not re-evaluate requiresApproval when neither category nor amount changed', async () => {
      const { svc, approvalGate } = makeService();
      await svc.update(salesmanUser, ENTRY_ID, { version: 0, notes: 'note only' });
      expect(approvalGate.requiresApproval).not.toHaveBeenCalled();
    });

    it('clears a prior approval when the amount changes on an already-approved entry', async () => {
      const { svc, tx } = makeService({ entrySnapshot: approvedEntry, approvalRequired: true });
      await svc.update(salesmanUser, ENTRY_ID, { version: 1, amount: 9000 });
      expect(tx.crewCashDistribution.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ approvedAt: null, approvedById: null }),
        }),
      );
    });

    it('writes an EDITED audit log entry with before/after snapshots', async () => {
      const { svc, tx } = makeService();
      await svc.update(salesmanUser, ENTRY_ID, { version: 0, amount: 100 });
      expect(tx.crewCashDistributionAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: CrewCashAuditAction.EDITED,
            beforeJson: expect.objectContaining({ amount: 50 }),
            afterJson: expect.objectContaining({ amount: 100 }),
          }),
        }),
      );
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('rejects deleting an entry already synced into the Payroll Ledger', async () => {
      const { svc } = makeService({ entrySnapshot: syncedEntry });
      await expect(svc.remove(salesmanUser, ENTRY_ID, { reason: 'oops' })).rejects.toThrow(BadRequestException);
    });

    it('rejects via the atomic deleteMany guard when a concurrent sync raced the initial read (TOCTOU close)', async () => {
      // The initial findFirst() read still sees syncedAt: null (passes the
      // first guard), but by the time the atomic delete runs, a concurrent
      // sheet-close sync has claimed the row — the deleteMany itself, scoped
      // to syncedAt: null, is the actual authoritative check, not the earlier
      // read. Proves the guard is real and correctly scoped, not decorative.
      const { svc, tx } = makeService({ entrySnapshot: baseEntry });
      tx.crewCashDistribution.deleteMany.mockResolvedValueOnce({ count: 0 });

      await expect(svc.remove(salesmanUser, ENTRY_ID, { reason: 'race' })).rejects.toThrow(BadRequestException);
      expect(tx.crewCashDistribution.deleteMany).toHaveBeenCalledWith({
        where: { id: ENTRY_ID, vendorId: VENDOR_ID, syncedAt: null },
      });
    });

    it("allows the entry's own creator to delete without crew_cash:delete", async () => {
      const { svc, tx } = makeService({ canPermission: false });
      const result = await svc.remove(salesmanUser, ENTRY_ID, {});
      expect(result).toEqual({ deleted: true });
      expect(tx.crewCashDistribution.deleteMany).toHaveBeenCalledWith({
        where: { id: ENTRY_ID, vendorId: VENDOR_ID, syncedAt: null },
      });
    });

    it('rejects a non-creator without crew_cash:delete', async () => {
      const { svc } = makeService({ canPermission: false });
      await expect(svc.remove(otherStaffUser, ENTRY_ID, {})).rejects.toThrow(ForbiddenException);
    });

    it('allows a crew_cash:delete holder to delete an entry they did not create', async () => {
      const { svc, permissions } = makeService({ canPermission: true });
      const result = await svc.remove(otherStaffUser, ENTRY_ID, {});
      expect(result).toEqual({ deleted: true });
      expect(permissions.can).toHaveBeenCalledWith(otherStaffUser.userId, 'crew_cash:delete');
    });

    it('writes a DELETED entry to CrewCashDistributionAuditLog (same table as every other action) before hard-deleting the row', async () => {
      const { svc, tx } = makeService();
      await svc.remove(salesmanUser, ENTRY_ID, { reason: 'entered by mistake' });

      expect(tx.crewCashDistributionAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            crewCashDistributionId: ENTRY_ID,
            actorId: salesmanUser.userId,
            action: CrewCashAuditAction.DELETED,
            reason: 'entered by mistake',
            beforeJson: expect.objectContaining({ amount: 50, employeeId: EMPLOYEE_ID }),
          }),
        }),
      );
      expect(tx.crewCashDistribution.deleteMany).toHaveBeenCalledWith({
        where: { id: ENTRY_ID, vendorId: VENDOR_ID, syncedAt: null },
      });

      // the audit write must precede the delete — proves it happened while
      // the row (and its FK) still existed, not as an afterthought.
      const auditOrder = tx.crewCashDistributionAuditLog.create.mock.invocationCallOrder[0];
      const deleteOrder = tx.crewCashDistribution.deleteMany.mock.invocationCallOrder[0];
      expect(auditOrder).toBeLessThan(deleteOrder);
    });

    it('the DELETED audit row survives the hard delete — crewCashDistributionId is nulled (ON DELETE SET NULL), not the row itself', async () => {
      const { svc, tx } = makeService();
      await svc.remove(salesmanUser, ENTRY_ID, { reason: 'entered by mistake' });

      const rows = await tx.crewCashDistributionAuditLog.findMany();
      const deletedRow = rows.find((r: any) => r.action === CrewCashAuditAction.DELETED && r.actorId === salesmanUser.userId);

      expect(deletedRow).toBeDefined();
      expect(deletedRow.crewCashDistributionId).toBeNull();
      expect(deletedRow.beforeJson).toEqual(
        expect.objectContaining({ employeeId: EMPLOYEE_ID, category: CrewCashCategory.TEA, amount: 50 }),
      );
    });
  });

  // ── approve ───────────────────────────────────────────────────────────────

  describe('approve()', () => {
    it('approves an entry that requires approval and is not yet approved', async () => {
      const { svc, tx } = makeService({ entrySnapshot: pendingApprovalEntry });
      const result = await svc.approve(adminUser, ENTRY_ID, { version: 1 });
      expect(result.approvedById).toBe(adminUser.userId);
      expect(tx.crewCashDistributionAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: CrewCashAuditAction.APPROVED }) }),
      );
    });

    it('rejects approving an entry that does not require approval', async () => {
      const { svc } = makeService({ entrySnapshot: baseEntry });
      await expect(svc.approve(adminUser, ENTRY_ID, { version: 0 })).rejects.toThrow(BadRequestException);
    });

    it('rejects approving an entry that is already approved', async () => {
      const { svc } = makeService({ entrySnapshot: approvedEntry });
      await expect(svc.approve(adminUser, ENTRY_ID, { version: 1 })).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on stale version', async () => {
      const { svc } = makeService({ entrySnapshot: pendingApprovalEntry });
      await expect(svc.approve(adminUser, ENTRY_ID, { version: 99 })).rejects.toThrow(ConflictException);
    });
  });

  // ── listForSheet ──────────────────────────────────────────────────────────

  describe('listForSheet()', () => {
    it('scopes the query to vendorId + dailySheetId', async () => {
      const { svc, prisma } = makeService();
      await svc.listForSheet(salesmanUser, SHEET_ID);
      expect(prisma.crewCashDistribution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { vendorId: VENDOR_ID, dailySheetId: SHEET_ID } }),
      );
    });

    it('throws NotFoundException when the sheet does not belong to this vendor', async () => {
      const { svc } = makeService({ sheet: null });
      await expect(svc.listForSheet(salesmanUser, SHEET_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── listForEmployee (self-view-only scoping) ─────────────────────────────

  describe('listForEmployee()', () => {
    it('allows a user to view their own history with no crew_cash:view_all permission', async () => {
      const { svc, permissions } = makeService({ canPermission: false });
      const self = { userId: EMPLOYEE_ID, vendorId: VENDOR_ID, role: 'DRIVER' } as any;
      await expect(svc.listForEmployee(self, EMPLOYEE_ID)).resolves.toBeDefined();
      expect(permissions.can).not.toHaveBeenCalled();
    });

    it("rejects viewing another employee's history without crew_cash:view_all", async () => {
      const { svc } = makeService({ canPermission: false });
      await expect(svc.listForEmployee(otherStaffUser, EMPLOYEE_ID)).rejects.toThrow(ForbiddenException);
    });

    it("allows viewing another employee's history with crew_cash:view_all", async () => {
      const { svc } = makeService({ canPermission: true });
      await expect(svc.listForEmployee(otherStaffUser, EMPLOYEE_ID)).resolves.toBeDefined();
    });

    it('throws NotFoundException when the employee does not belong to this vendor', async () => {
      const { svc } = makeService({ canPermission: true, employeeExists: false });
      await expect(svc.listForEmployee(otherStaffUser, EMPLOYEE_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
