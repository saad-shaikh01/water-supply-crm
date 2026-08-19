import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CrewCashDistributionService } from './crew-cash-distribution.service';
import { CrewCashAuditAction, CrewCashCategory, LedgerEntryStatus } from '@prisma/client';

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

const LEDGER_ENTRY_ID = 'ledger-entry-001';
const syncedEntry = { ...baseEntry, syncedAt: new Date('2026-08-02'), syncedLedgerEntryId: LEDGER_ENTRY_ID };
const approvedEntry = { ...baseEntry, requiresApproval: true, approvedAt: new Date('2026-08-01'), approvedById: 'admin-001', version: 1 };
const pendingApprovalEntry = { ...baseEntry, requiresApproval: true, version: 1 };

// The linked StaffLedgerEntry a synced Crew Cash row points at — used by
// correctSyncedEntry() tests below. `notLockedLedgerEntry` models the
// "closed sheet, not-yet-locked payroll" window (payrollEntryId: null);
// `lockedLedgerEntry` models the entry already rolled into a locked period.
const notLockedLedgerEntry = {
  id: LEDGER_ENTRY_ID,
  vendorId: VENDOR_ID,
  userId: EMPLOYEE_ID,
  category: 'CREW_CASH',
  amount: -50,
  effectiveDate: new Date('2026-08-01'),
  description: 'Crew Cash — TEA',
  status: LedgerEntryStatus.POSTED,
  createdById: 'admin-001',
  payrollEntryId: null as string | null,
  version: 0,
};
const lockedLedgerEntry = { ...notLockedLedgerEntry, payrollEntryId: 'payroll-entry-001', version: 2 };

// ─── mock tx factory ────────────────────────────────────────────────────────
//
// Models the atomic CAS semantics of `updateMany({ where: { id, vendorId,
// version } })` exactly like StaffLedgerService's own spec: `current` tracks
// the live row across calls on this tx instance, `findFirst` returns a
// frozen pre-image (models two concurrent readers).

function makeTx(
  entrySnapshot: any = baseEntry,
  opts: { sheetIsClosed?: boolean; ledgerEntrySnapshot?: any; targetEmployeeExists?: boolean } = {},
) {
  let current = { ...entrySnapshot };
  // Models CrewCashDistributionAuditLog as a real table so the SET NULL
  // cascade (migration 20260806205508_crew_cash_audit_log_nullable_fk) can be
  // simulated on `crewCashDistribution.deleteMany` below, instead of a bare mock.
  const auditLogStore: any[] = [];
  let auditLogSeq = 0;
  let ledgerEntrySeq = 0;
  const ledgerEntryStore: any[] = [];

  return {
    crewCashDistribution: {
      findFirst: jest.fn().mockImplementation(async () => ({ ...entrySnapshot })),
      findMany: jest.fn().mockImplementation(async () => []),
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
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        if (where.id === current.id) current = { ...current, ...data };
        return { ...current };
      }),
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
    staffLedgerEntry: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const row = { id: `ledger-${++ledgerEntrySeq}`, version: 0, createdAt: new Date(), ...data };
        ledgerEntryStore.push(row);
        return row;
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...(opts.ledgerEntrySnapshot ?? notLockedLedgerEntry) })),
    },
    user: {
      findFirst: jest.fn().mockImplementation(async () => (opts.targetEmployeeExists === false ? null : { id: 'some-user' })),
    },
    dailySheet: {
      findUnique: jest.fn().mockResolvedValue({ isClosed: opts.sheetIsClosed ?? false }),
    },
    auditLogStore,
    ledgerEntryStore,
  };
}

// ─── service factory ────────────────────────────────────────────────────────

function makeStaffLedgerMock() {
  return {
    voidEntryTx: jest.fn().mockResolvedValue(undefined),
    reverseTx: jest.fn().mockResolvedValue({ original: {}, reversal: { id: 'reversal-ledger-1' } }),
    correctTx: jest.fn().mockResolvedValue({ original: {}, reversal: {}, correction: { id: 'correction-ledger-1' } }),
    createTx: jest.fn().mockImplementation(async (_tx: any, _user: any, dto: any) => ({ id: 'fresh-ledger-1', ...dto })),
  };
}

function makeService(
  opts: {
    entrySnapshot?: any;
    sheet?: any;
    isCrew?: boolean;
    approvalRequired?: boolean;
    canPermission?: boolean;
    employeeExists?: boolean;
    duplicateCount?: number;
    sheetIsClosed?: boolean;
    ledgerEntrySnapshot?: any;
    targetEmployeeExists?: boolean;
    activeTrip?: { id: string } | null;
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
    sheetIsClosed = false,
    ledgerEntrySnapshot,
    targetEmployeeExists,
    activeTrip = null,
  } = opts;

  const tx = makeTx(entrySnapshot, { sheetIsClosed, ledgerEntrySnapshot, targetEmployeeExists });
  tx.crewCashDistribution.count.mockResolvedValue(duplicateCount);

  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    dailySheet: {
      findFirst: jest.fn().mockResolvedValue(sheet),
      // Only relevant to syncStaleSheets() — default empty so every other
      // describe block (which never calls it) stays unaffected.
      findMany: jest.fn().mockResolvedValue([]),
    },
    dailySheetCrew: { findUnique: jest.fn().mockResolvedValue(isCrew ? { id: 'crew-row-1' } : null) },
    user: { findFirst: jest.fn().mockResolvedValue(employeeExists ? { id: EMPLOYEE_ID } : null) },
    crewCashDistribution: { findMany: jest.fn().mockResolvedValue([]) },
    // Trip feature: create() looks up the sheet's active trip (outside the
    // tx) to stamp dailySheetLoadId — no active trip by default in these tests.
    dailySheetLoad: { findFirst: jest.fn().mockResolvedValue(activeTrip) },
  };
  const approvalGate = { requiresApproval: jest.fn().mockResolvedValue(approvalRequired) };
  const permissions = { can: jest.fn().mockResolvedValue(canPermission) };
  const staffLedger = makeStaffLedgerMock();
  const crewCashSyncQueue = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined) };

  const svc = new CrewCashDistributionService(
    prisma as any,
    approvalGate as any,
    permissions as any,
    staffLedger as any,
    crewCashSyncQueue as any,
  );
  return { svc, prisma, tx, approvalGate, permissions, staffLedger, crewCashSyncQueue };
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

    it('attributes the entry to the currently active trip via dailySheetLoadId', async () => {
      const { svc, tx } = makeService({ activeTrip: { id: 'trip-1' } });
      await svc.create(salesmanUser, SHEET_ID, createDto);
      expect(tx.crewCashDistribution.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ dailySheetLoadId: 'trip-1' }) }),
      );
    });

    it('leaves dailySheetLoadId null when no trip is active', async () => {
      const { svc, tx } = makeService({ activeTrip: null });
      await svc.create(salesmanUser, SHEET_ID, createDto);
      expect(tx.crewCashDistribution.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ dailySheetLoadId: null }) }),
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

    it('does NOT sync when the sheet is still open — behavior unchanged from Phase 3-2', async () => {
      const { svc, tx } = makeService({ entrySnapshot: pendingApprovalEntry, sheetIsClosed: false });
      const result = await svc.approve(adminUser, ENTRY_ID, { version: 1 });

      expect(result.approvedById).toBe(adminUser.userId);
      expect(result.syncedAt ?? null).toBeNull();
      expect(tx.staffLedgerEntry.create).not.toHaveBeenCalled();
      expect(tx.crewCashDistributionAuditLog.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: CrewCashAuditAction.SYNCED }) }),
      );
    });

    it('triggers an immediate sync when the sheet is ALREADY closed at approval time', async () => {
      const { svc, tx } = makeService({ entrySnapshot: pendingApprovalEntry, sheetIsClosed: true });
      const result = await svc.approve(adminUser, ENTRY_ID, { version: 1 });

      expect(tx.dailySheet.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: pendingApprovalEntry.dailySheetId } }),
      );
      expect(tx.staffLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            category: 'CREW_CASH',
            amount: -pendingApprovalEntry.amount,
            userId: pendingApprovalEntry.employeeId,
            status: 'POSTED',
          }),
        }),
      );
      expect(result.syncedAt).not.toBeNull();
      expect(result.syncedLedgerEntryId).toBe(tx.ledgerEntryStore[0].id);
      expect(tx.crewCashDistributionAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: CrewCashAuditAction.SYNCED }) }),
      );
    });
  });

  // ── syncSheetToLedger ─────────────────────────────────────────────────────

  describe('syncSheetToLedger()', () => {
    const eligibleRow = { ...baseEntry, id: 'row-eligible' }; // requiresApproval=false, syncedAt=null
    const approvedRow = { ...baseEntry, id: 'row-approved', requiresApproval: true, approvedAt: new Date('2026-08-01'), approvedById: 'admin-001' };
    const pendingRow = { ...baseEntry, id: 'row-pending', requiresApproval: true, approvedAt: null };
    const alreadySyncedRow = { ...baseEntry, id: 'row-synced', syncedLedgerEntryId: 'ledger-existing' };

    it('creates a StaffLedgerEntry (correct sign/category/fields) for an eligible row and marks it synced', async () => {
      const { svc, tx } = makeService();
      tx.crewCashDistribution.findMany.mockResolvedValue([eligibleRow]);

      const result = await svc.syncSheetToLedger(tx as any, VENDOR_ID, SHEET_ID, adminUser.userId, adminUser.role);

      expect(result).toEqual({ synced: 1, skippedPendingApproval: 0 });
      expect(tx.staffLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            vendorId: VENDOR_ID,
            userId: eligibleRow.employeeId,
            category: 'CREW_CASH',
            amount: -eligibleRow.amount, // debit — negative of the row's positive magnitude
            effectiveDate: eligibleRow.date,
            status: 'POSTED',
            createdById: adminUser.userId,
          }),
        }),
      );
      expect(tx.crewCashDistribution.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: eligibleRow.id },
          data: expect.objectContaining({ syncedLedgerEntryId: tx.ledgerEntryStore[0].id }),
        }),
      );
    });

    it('syncs an already-approved row alongside a non-approval-required row', async () => {
      const { svc, tx } = makeService();
      tx.crewCashDistribution.findMany.mockResolvedValue([eligibleRow, approvedRow]);

      const result = await svc.syncSheetToLedger(tx as any, VENDOR_ID, SHEET_ID, adminUser.userId, adminUser.role);

      expect(result).toEqual({ synced: 2, skippedPendingApproval: 0 });
      expect(tx.staffLedgerEntry.create).toHaveBeenCalledTimes(2);
    });

    it('skips a row that requires approval and is not yet approved, without touching it', async () => {
      const { svc, tx } = makeService();
      tx.crewCashDistribution.findMany.mockResolvedValue([pendingRow]);

      const result = await svc.syncSheetToLedger(tx as any, VENDOR_ID, SHEET_ID, adminUser.userId, adminUser.role);

      expect(result).toEqual({ synced: 0, skippedPendingApproval: 1 });
      expect(tx.staffLedgerEntry.create).not.toHaveBeenCalled();
      expect(tx.crewCashDistribution.update).not.toHaveBeenCalled();
    });

    it('is idempotent — a row with syncedLedgerEntryId already set is skipped even though syncedAt: null is always the query filter', async () => {
      const { svc, tx } = makeService();
      tx.crewCashDistribution.findMany.mockResolvedValue([alreadySyncedRow]);

      const result = await svc.syncSheetToLedger(tx as any, VENDOR_ID, SHEET_ID, adminUser.userId, adminUser.role);

      expect(result).toEqual({ synced: 0, skippedPendingApproval: 0 });
      expect(tx.staffLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('writes a SYNCED audit log entry for each synced row', async () => {
      const { svc, tx } = makeService();
      tx.crewCashDistribution.findMany.mockResolvedValue([eligibleRow]);

      await svc.syncSheetToLedger(tx as any, VENDOR_ID, SHEET_ID, adminUser.userId, adminUser.role);

      expect(tx.crewCashDistributionAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            crewCashDistributionId: eligibleRow.id,
            actorId: adminUser.userId,
            actorRole: adminUser.role,
            action: CrewCashAuditAction.SYNCED,
          }),
        }),
      );
    });

    it('queries only rows scoped to this sheet with syncedAt: null', async () => {
      const { svc, tx } = makeService();
      tx.crewCashDistribution.findMany.mockResolvedValue([]);

      await svc.syncSheetToLedger(tx as any, VENDOR_ID, SHEET_ID, adminUser.userId, adminUser.role);

      expect(tx.crewCashDistribution.findMany).toHaveBeenCalledWith({
        where: { vendorId: VENDOR_ID, dailySheetId: SHEET_ID, syncedAt: null },
      });
    });
  });

  // ── syncStaleSheets (nightly decoupled sweep) ────────────────────────────

  describe('syncStaleSheets()', () => {
    const staleSheetRow = { id: SHEET_ID, vendorId: VENDOR_ID, driverId: DRIVER_ID };

    it('queries only open sheets whose date is before today with an unsynced row', async () => {
      const { svc, prisma } = makeService();
      await svc.syncStaleSheets();

      expect(prisma.dailySheet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isClosed: false,
            crewCashDistributions: { some: { syncedAt: null } },
          }),
        }),
      );
    });

    it('syncs eligible rows for a stale open sheet and never flips isClosed', async () => {
      const { svc, prisma, tx } = makeService();
      prisma.dailySheet.findMany.mockResolvedValue([staleSheetRow]);
      tx.crewCashDistribution.findMany.mockResolvedValue([{ ...baseEntry, id: 'row-stale' }]);

      const result = await svc.syncStaleSheets();

      expect(result).toEqual({ sheetsSynced: 1, sheetsFailed: 0, rowsSynced: 1 });
      expect(tx.staffLedgerEntry.create).toHaveBeenCalledTimes(1);
      // dailySheet.update is never mocked/defined on this prisma double — had
      // syncStaleSheets tried to flip isClosed, this test would have thrown
      // a TypeError instead of resolving.
    });

    it('attributes the sync to the sheet\'s own driver (no human actor exists for an automated sweep)', async () => {
      const { svc, prisma, tx } = makeService();
      prisma.dailySheet.findMany.mockResolvedValue([staleSheetRow]);
      tx.crewCashDistribution.findMany.mockResolvedValue([{ ...baseEntry, id: 'row-stale' }]);

      await svc.syncStaleSheets();

      expect(tx.crewCashDistributionAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actorId: DRIVER_ID, actorRole: 'DRIVER', action: CrewCashAuditAction.SYNCED }),
        }),
      );
    });

    it('skips rows still pending approval, same as the close-time sweep', async () => {
      const { svc, prisma, tx } = makeService();
      prisma.dailySheet.findMany.mockResolvedValue([staleSheetRow]);
      tx.crewCashDistribution.findMany.mockResolvedValue([{ ...baseEntry, id: 'row-pending', requiresApproval: true, approvedAt: null }]);

      const result = await svc.syncStaleSheets();

      expect(result).toEqual({ sheetsSynced: 1, sheetsFailed: 0, rowsSynced: 0 });
      expect(tx.staffLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('continues processing remaining sheets when one sheet sync throws, and reports it as failed', async () => {
      const { svc, prisma } = makeService();
      prisma.dailySheet.findMany.mockResolvedValue([staleSheetRow, { ...staleSheetRow, id: 'sheet-002' }]);
      prisma.$transaction
        .mockImplementationOnce(async () => { throw new Error('boom'); })
        .mockImplementationOnce(async (cb: any) => cb({
          crewCashDistribution: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
          crewCashDistributionAuditLog: { create: jest.fn() },
          staffLedgerEntry: { create: jest.fn() },
        }));

      const result = await svc.syncStaleSheets();

      expect(result).toEqual({ sheetsSynced: 1, sheetsFailed: 1, rowsSynced: 0 });
    });

    it('returns zero counts when no stale sheets exist', async () => {
      const { svc, prisma } = makeService();
      prisma.dailySheet.findMany.mockResolvedValue([]);

      const result = await svc.syncStaleSheets();

      expect(result).toEqual({ sheetsSynced: 0, sheetsFailed: 0, rowsSynced: 0 });
    });
  });

  // ── correctSyncedEntry (post-close correction) ───────────────────────────

  describe('correctSyncedEntry()', () => {
    const correctReasonOnly = { reason: 'no-op guard' };
    const correctAmountOnly = { newAmount: 300, reason: 'was actually Rs.300, typo'  };
    const correctEmployeeOnly = { newEmployeeId: 'other-employee-001', reason: 'wrong crew member selected' };

    it('rejects a row that has not yet synced into the Payroll Ledger', async () => {
      const { svc } = makeService({ entrySnapshot: baseEntry }); // syncedLedgerEntryId: null
      await expect(svc.correctSyncedEntry(adminUser, ENTRY_ID, correctAmountOnly)).rejects.toThrow(BadRequestException);
    });

    it('rejects when none of newEmployeeId/newCategory/newAmount is provided (mandatory-reason-only is a no-op)', async () => {
      const { svc } = makeService({ entrySnapshot: syncedEntry });
      await expect(svc.correctSyncedEntry(adminUser, ENTRY_ID, correctReasonOnly)).rejects.toThrow(BadRequestException);
    });

    it("DTO validation rejects a missing/empty 'reason' (mandatory field)", async () => {
      // Exercises the actual class-validator decorators on the DTO — the
      // service itself never re-checks `reason`'s presence, it trusts the
      // ValidationPipe already rejected the request before this point.
      const { validate } = await import('class-validator');
      const { plainToInstance } = await import('class-transformer');
      const { CorrectCrewCashDistributionDto } = await import('./dto/correct-crew-cash-distribution.dto');

      const missingReason = plainToInstance(CorrectCrewCashDistributionDto, { newAmount: 300 });
      const emptyReason = plainToInstance(CorrectCrewCashDistributionDto, { newAmount: 300, reason: '' });

      const missingErrors = await validate(missingReason);
      const emptyErrors = await validate(emptyReason);

      expect(missingErrors.some((e) => e.property === 'reason')).toBe(true);
      expect(emptyErrors.some((e) => e.property === 'reason')).toBe(true);
    });

    describe('branch: not yet locked (payrollEntryId === null) → void + create', () => {
      it('voids the original ledger entry and creates a fresh replacement, atomically', async () => {
        const { svc, staffLedger, tx } = makeService({
          entrySnapshot: syncedEntry,
          ledgerEntrySnapshot: notLockedLedgerEntry,
        });

        await svc.correctSyncedEntry(adminUser, ENTRY_ID, correctAmountOnly);

        expect(staffLedger.voidEntryTx).toHaveBeenCalledWith(
          tx,
          adminUser,
          LEDGER_ENTRY_ID,
          expect.objectContaining({ version: notLockedLedgerEntry.version, reason: correctAmountOnly.reason }),
        );
        expect(staffLedger.createTx).toHaveBeenCalledWith(
          tx,
          adminUser,
          expect.objectContaining({
            userId: syncedEntry.employeeId,
            category: 'CREW_CASH',
            amount: -300,
          }),
        );
        expect(staffLedger.reverseTx).not.toHaveBeenCalled();
        expect(staffLedger.correctTx).not.toHaveBeenCalled();
      });

      it('reassigns to the new employee when newEmployeeId is provided, still via void + create', async () => {
        const { svc, staffLedger, tx } = makeService({
          entrySnapshot: syncedEntry,
          ledgerEntrySnapshot: notLockedLedgerEntry,
          targetEmployeeExists: true,
        });

        await svc.correctSyncedEntry(adminUser, ENTRY_ID, correctEmployeeOnly);

        expect(staffLedger.voidEntryTx).toHaveBeenCalled();
        expect(staffLedger.createTx).toHaveBeenCalledWith(
          tx,
          adminUser,
          expect.objectContaining({ userId: 'other-employee-001', amount: -syncedEntry.amount }),
        );
      });

      it("rejects reassignment to an employee that doesn't belong to this vendor", async () => {
        const { svc } = makeService({
          entrySnapshot: syncedEntry,
          ledgerEntrySnapshot: notLockedLedgerEntry,
          targetEmployeeExists: false,
        });

        await expect(svc.correctSyncedEntry(adminUser, ENTRY_ID, correctEmployeeOnly)).rejects.toThrow(NotFoundException);
      });

      it('writes a CORRECTED audit log entry', async () => {
        const { svc, tx } = makeService({ entrySnapshot: syncedEntry, ledgerEntrySnapshot: notLockedLedgerEntry });

        await svc.correctSyncedEntry(adminUser, ENTRY_ID, correctAmountOnly);

        expect(tx.crewCashDistributionAuditLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              crewCashDistributionId: ENTRY_ID,
              action: CrewCashAuditAction.CORRECTED,
              reason: correctAmountOnly.reason,
            }),
          }),
        );
      });
    });

    describe('branch: locked (payrollEntryId !== null), same employee → correct()', () => {
      it("calls correctTx with the negated corrected amount, not void/reverse", async () => {
        const { svc, staffLedger, tx } = makeService({
          entrySnapshot: syncedEntry,
          ledgerEntrySnapshot: lockedLedgerEntry,
        });

        await svc.correctSyncedEntry(adminUser, ENTRY_ID, correctAmountOnly);

        expect(staffLedger.correctTx).toHaveBeenCalledWith(
          tx,
          adminUser,
          LEDGER_ENTRY_ID,
          expect.objectContaining({ version: lockedLedgerEntry.version, reason: correctAmountOnly.reason, correctedAmount: -300 }),
        );
        expect(staffLedger.voidEntryTx).not.toHaveBeenCalled();
        expect(staffLedger.reverseTx).not.toHaveBeenCalled();
        expect(staffLedger.createTx).not.toHaveBeenCalled();
      });

      it('writes a CORRECTED audit log entry', async () => {
        const { svc, tx } = makeService({ entrySnapshot: syncedEntry, ledgerEntrySnapshot: lockedLedgerEntry });

        await svc.correctSyncedEntry(adminUser, ENTRY_ID, correctAmountOnly);

        expect(tx.crewCashDistributionAuditLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ action: CrewCashAuditAction.CORRECTED }),
          }),
        );
      });
    });

    describe('branch: locked (payrollEntryId !== null), different employee → reverse() + create()', () => {
      it('reverses the original (wrong-employee) entry and creates a separate fresh entry for the right employee', async () => {
        const { svc, staffLedger, tx } = makeService({
          entrySnapshot: syncedEntry,
          ledgerEntrySnapshot: lockedLedgerEntry,
          targetEmployeeExists: true,
        });

        await svc.correctSyncedEntry(adminUser, ENTRY_ID, correctEmployeeOnly);

        expect(staffLedger.reverseTx).toHaveBeenCalledWith(
          tx,
          adminUser,
          LEDGER_ENTRY_ID,
          expect.objectContaining({ version: lockedLedgerEntry.version, reason: correctEmployeeOnly.reason }),
        );
        expect(staffLedger.createTx).toHaveBeenCalledWith(
          tx,
          adminUser,
          expect.objectContaining({ userId: 'other-employee-001', amount: -syncedEntry.amount }),
        );
        expect(staffLedger.correctTx).not.toHaveBeenCalled();
        expect(staffLedger.voidEntryTx).not.toHaveBeenCalled();
      });

      it('writes a REVERSED audit log entry (not CORRECTED)', async () => {
        const { svc, tx } = makeService({
          entrySnapshot: syncedEntry,
          ledgerEntrySnapshot: lockedLedgerEntry,
          targetEmployeeExists: true,
        });

        await svc.correctSyncedEntry(adminUser, ENTRY_ID, correctEmployeeOnly);

        expect(tx.crewCashDistributionAuditLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ action: CrewCashAuditAction.REVERSED, reason: correctEmployeeOnly.reason }),
          }),
        );
      });

      it("rejects reassignment to an employee that doesn't belong to this vendor", async () => {
        const { svc } = makeService({
          entrySnapshot: syncedEntry,
          ledgerEntrySnapshot: lockedLedgerEntry,
          targetEmployeeExists: false,
        });

        await expect(svc.correctSyncedEntry(adminUser, ENTRY_ID, correctEmployeeOnly)).rejects.toThrow(NotFoundException);
      });
    });

    it("never mutates the CrewCashDistribution row's own data fields — category/amount/employeeId/syncedLedgerEntryId stay exactly as they were before the correction", async () => {
      const { svc, tx } = makeService({ entrySnapshot: syncedEntry, ledgerEntrySnapshot: lockedLedgerEntry, targetEmployeeExists: true });

      const result = await svc.correctSyncedEntry(adminUser, ENTRY_ID, {
        newEmployeeId: 'other-employee-001',
        newCategory: CrewCashCategory.EMERGENCY_CASH,
        newAmount: 9999,
        reason: 'testing row immutability',
      });

      expect(result.category).toBe(syncedEntry.category);
      expect(result.amount).toBe(syncedEntry.amount);
      expect(result.employeeId).toBe(syncedEntry.employeeId);
      expect(result.syncedLedgerEntryId).toBe(syncedEntry.syncedLedgerEntryId);
      expect(tx.crewCashDistribution.update).not.toHaveBeenCalled();
      expect(tx.crewCashDistribution.updateMany).not.toHaveBeenCalled();
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
