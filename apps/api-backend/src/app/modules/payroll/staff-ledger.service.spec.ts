import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StaffLedgerService } from './staff-ledger.service';
import { LedgerEntryStatus, StaffLedgerAuditAction, StaffLedgerCategory } from '@prisma/client';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const VENDOR_ID   = 'vendor-001';
const EMPLOYEE_ID = 'employee-001';
const ENTRY_ID    = 'entry-001';

// The fixture entries below carry `createdById: 'admin-001'`, so `adminUser` is
// both the usual "has payroll:ledger_void" actor AND the entry's creator — a
// third `otherStaffUser` (neither the creator nor a permission holder) is used
// by the voidEntry authorization tests below to tell the two paths apart.
const adminUser = { userId: 'admin-001', vendorId: VENDOR_ID, role: 'VENDOR_ADMIN' } as any;
const otherStaffUser = { userId: 'staff-002', vendorId: VENDOR_ID, role: 'STAFF' } as any;

const pendingEntry = {
  id: ENTRY_ID, vendorId: VENDOR_ID, userId: EMPLOYEE_ID,
  category: StaffLedgerCategory.BONUS, amount: 1000,
  effectiveDate: new Date('2026-08-01'), description: null,
  status: LedgerEntryStatus.PENDING,
  createdById: 'admin-001', approvedById: null, approvedAt: null,
  payrollEntryId: null, reversedEntryId: null,
  version: 0, createdAt: new Date(), updatedAt: new Date(),
};

const postedPreLockEntry = { ...pendingEntry, status: LedgerEntryStatus.POSTED, version: 1 };
const postedLockedEntry  = { ...pendingEntry, status: LedgerEntryStatus.POSTED, payrollEntryId: 'payroll-entry-001', version: 2, amount: 500 };

// ─── mock tx factory ─────────────────────────────────────────────────────────
//
// Models the atomic compare-and-swap semantics of the real
// `updateMany({ where: { id, vendorId, version } })` call: it only "commits"
// (count: 1) when the caller's `version` still matches the row's CURRENT
// version, tracked in `current` across calls on this same tx instance.
//
// `findFirst` intentionally returns a FROZEN snapshot (not the live
// `current`) — this models two concurrent callers both having read the row
// BEFORE either of them committed (the realistic race: both see the same
// pre-image, e.g. still PENDING/version 0), so the precondition checks in
// the service can't be what tells them apart. Only the atomic `updateMany`
// CAS against the live `current.version` decides the winner — exactly the
// property under test in the "under a concurrent race" cases below.

function makeTx(entrySnapshot: any = pendingEntry) {
  let current = { ...entrySnapshot };

  return {
    staffLedgerEntry: {
      findFirst: jest.fn().mockResolvedValue({ ...entrySnapshot }),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => current),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: 'new-entry-001', version: 0, createdAt: new Date(), updatedAt: new Date(), ...data,
      })),
      updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
        if (where.version !== current.version) return { count: 0 };
        const versionBump = data.version?.increment ?? 0;
        current = { ...current, ...data, version: current.version + versionBump };
        return { count: 1 };
      }),
    },
    staffLedgerAuditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-001' }) },
  };
}

// ─── service factory ─────────────────────────────────────────────────────────

function makeService(entrySnapshot: any = pendingEntry, userExists = true, canViewAll = true) {
  const tx = makeTx(entrySnapshot);
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    user: { findFirst: jest.fn().mockResolvedValue(userExists ? { id: EMPLOYEE_ID } : null) },
    staffLedgerEntry: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  };
  const approvalGate = { requiresApproval: jest.fn().mockResolvedValue(false) };
  const permissions = { can: jest.fn().mockResolvedValue(canViewAll) };

  const svc = new StaffLedgerService(prisma as any, approvalGate as any, permissions as any);
  return { svc, prisma, tx, approvalGate, permissions };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('StaffLedgerService', () => {
  // ── create: PENDING vs POSTED gating ────────────────────────────────────

  describe('create()', () => {
    const createDto = {
      userId: EMPLOYEE_ID, category: StaffLedgerCategory.BONUS,
      amount: 1000, effectiveDate: '2026-08-01', description: 'Eid bonus',
    };

    it('creates a POSTED entry when the approval gate does not trip', async () => {
      const { svc, tx } = makeService();
      const entry = await svc.create(adminUser, createDto);
      expect(entry.status).toBe(LedgerEntryStatus.POSTED);
      expect(tx.staffLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: LedgerEntryStatus.POSTED }) }),
      );
    });

    it('creates a PENDING entry when the approval gate trips', async () => {
      const { svc, approvalGate } = makeService();
      approvalGate.requiresApproval.mockResolvedValue(true);

      const entry = await svc.create(adminUser, createDto);
      expect(entry.status).toBe(LedgerEntryStatus.PENDING);
    });

    it('writes a CREATED audit log entry inside the same transaction', async () => {
      const { svc, tx, prisma } = makeService();
      await svc.create(adminUser, createDto);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.staffLedgerAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: StaffLedgerAuditAction.CREATED }) }),
      );
    });

    it('throws NotFoundException when the employee does not belong to this vendor', async () => {
      const { svc } = makeService(pendingEntry, false);
      await expect(svc.create(adminUser, createDto)).rejects.toThrow(NotFoundException);
    });
  });

  // ── voidEntry: requires reason, gating ──────────────────────────────────

  describe('voidEntry()', () => {
    it('voids a PENDING entry', async () => {
      const { svc, tx } = makeService(pendingEntry);
      const result = await svc.voidEntry(adminUser, ENTRY_ID, { version: 0, reason: 'entered by mistake' });
      expect(result.status).toBe(LedgerEntryStatus.VOIDED);
      expect(tx.staffLedgerEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ENTRY_ID, vendorId: VENDOR_ID, version: 0 } }),
      );
      expect(tx.staffLedgerAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: StaffLedgerAuditAction.VOIDED, reason: 'entered by mistake' }),
        }),
      );
    });

    it('voids a POSTED entry not yet rolled into a locked payroll period', async () => {
      const { svc } = makeService(postedPreLockEntry);
      const result = await svc.voidEntry(adminUser, ENTRY_ID, { version: 1, reason: 'wrong amount' });
      expect(result.status).toBe(LedgerEntryStatus.VOIDED);
    });

    it('rejects voiding a POSTED entry already rolled into a locked payroll period', async () => {
      const { svc } = makeService(postedLockedEntry);
      await expect(
        svc.voidEntry(adminUser, ENTRY_ID, { version: 2, reason: 'too late now' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on stale version', async () => {
      const { svc } = makeService(pendingEntry);
      await expect(
        svc.voidEntry(adminUser, ENTRY_ID, { version: 99, reason: 'stale' }),
      ).rejects.toThrow(ConflictException);
    });

    it('under a concurrent race, the first void succeeds and the second throws ConflictException', async () => {
      const { svc, tx } = makeService(pendingEntry);

      const first = await svc.voidEntry(adminUser, ENTRY_ID, { version: 0, reason: 'first caller wins' });
      expect(first.status).toBe(LedgerEntryStatus.VOIDED);

      // The second caller read the row before the first committed and still
      // believes version 0 is current — the DB-level CAS (updateMany WHERE
      // version: 0) now finds count: 0 because the first call already
      // bumped it to 1.
      await expect(
        svc.voidEntry(adminUser, ENTRY_ID, { version: 0, reason: 'second caller loses' }),
      ).rejects.toThrow(ConflictException);

      expect(tx.staffLedgerEntry.updateMany).toHaveBeenCalledTimes(2);
    });

    // ── voidEntry: "creator or payroll:ledger_void" authorization ──────────

    it('allows the entry\'s own creator to void it even without payroll:ledger_void', async () => {
      const { svc } = makeService(pendingEntry, true, false); // permissions.can() → false
      const result = await svc.voidEntry(adminUser, ENTRY_ID, { version: 0, reason: 'creator self-service' });
      expect(result.status).toBe(LedgerEntryStatus.VOIDED);
    });

    it('allows a payroll:ledger_void holder to void an entry they did NOT create', async () => {
      const { svc, permissions } = makeService(pendingEntry, true, true); // permissions.can() → true
      const result = await svc.voidEntry(otherStaffUser, ENTRY_ID, { version: 0, reason: 'admin override' });
      expect(result.status).toBe(LedgerEntryStatus.VOIDED);
      expect(permissions.can).toHaveBeenCalledWith(otherStaffUser.userId, 'payroll:ledger_void');
    });

    it('rejects a caller who neither created the entry nor holds payroll:ledger_void', async () => {
      const { svc } = makeService(pendingEntry, true, false); // permissions.can() → false
      await expect(
        svc.voidEntry(otherStaffUser, ENTRY_ID, { version: 0, reason: 'not mine' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── approve ──────────────────────────────────────────────────────────────

  describe('approve()', () => {
    it('posts a PENDING entry and records approvedById/approvedAt', async () => {
      const { svc, tx } = makeService(pendingEntry);
      const result = await svc.approve(adminUser, ENTRY_ID, { version: 0 });
      expect(result.status).toBe(LedgerEntryStatus.POSTED);
      expect(tx.staffLedgerEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ENTRY_ID, vendorId: VENDOR_ID, version: 0 },
          data: expect.objectContaining({ status: LedgerEntryStatus.POSTED, approvedById: adminUser.userId }),
        }),
      );
    });

    it('rejects approving a non-PENDING entry', async () => {
      const { svc } = makeService(postedPreLockEntry);
      await expect(svc.approve(adminUser, ENTRY_ID, { version: 1 })).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on stale version', async () => {
      const { svc } = makeService(pendingEntry);
      await expect(svc.approve(adminUser, ENTRY_ID, { version: 7 })).rejects.toThrow(ConflictException);
    });

    it('under a concurrent race, the first approve succeeds and the second throws ConflictException', async () => {
      const { svc } = makeService(pendingEntry);

      const first = await svc.approve(adminUser, ENTRY_ID, { version: 0 });
      expect(first.status).toBe(LedgerEntryStatus.POSTED);

      await expect(svc.approve(adminUser, ENTRY_ID, { version: 0 })).rejects.toThrow(ConflictException);
    });
  });

  // ── reverse: opposite-sign entry + linkage ──────────────────────────────

  describe('reverse()', () => {
    it('creates an opposite-sign REVERSAL entry linked to the original', async () => {
      const { svc, tx } = makeService(postedLockedEntry);
      const result = await svc.reverse(adminUser, ENTRY_ID, { version: 2, reason: 'driver double-counted' });

      expect(result.reversal.category).toBe(StaffLedgerCategory.REVERSAL);
      expect(result.reversal.amount).toBe(-postedLockedEntry.amount);
      expect(result.reversal.reversedEntryId).toBe(ENTRY_ID);
      expect(tx.staffLedgerEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ENTRY_ID, vendorId: VENDOR_ID, version: 2 },
          data: { version: { increment: 1 } },
        }),
      );
    });

    it('claims the version (CAS) before creating the reversal row, so a stale version never creates an orphan entry', async () => {
      const { svc, tx } = makeService(postedLockedEntry);
      await expect(
        svc.reverse(adminUser, ENTRY_ID, { version: 0, reason: 'stale' }),
      ).rejects.toThrow(ConflictException);
      expect(tx.staffLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('writes REVERSED audit logs against both the original and the new entry', async () => {
      const { svc, tx } = makeService(postedLockedEntry);
      await svc.reverse(adminUser, ENTRY_ID, { version: 2, reason: 'driver double-counted' });

      const calls = tx.staffLedgerAuditLog.create.mock.calls.map((c: any) => c[0].data);
      expect(calls.filter((d: any) => d.action === StaffLedgerAuditAction.REVERSED)).toHaveLength(2);
      expect(calls.every((d: any) => d.reason === 'driver double-counted')).toBe(true);
    });

    it('rejects reversing an entry not yet rolled into a locked payroll period', async () => {
      const { svc } = makeService(postedPreLockEntry);
      await expect(
        svc.reverse(adminUser, ENTRY_ID, { version: 1, reason: 'too early' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects reversing a non-POSTED entry', async () => {
      const { svc } = makeService(pendingEntry);
      await expect(
        svc.reverse(adminUser, ENTRY_ID, { version: 0, reason: 'still pending' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on stale version', async () => {
      const { svc } = makeService(postedLockedEntry);
      await expect(
        svc.reverse(adminUser, ENTRY_ID, { version: 0, reason: 'stale' }),
      ).rejects.toThrow(ConflictException);
    });

    it('under a concurrent race, the first reverse succeeds and the second throws ConflictException', async () => {
      const { svc } = makeService(postedLockedEntry);

      const first = await svc.reverse(adminUser, ENTRY_ID, { version: 2, reason: 'first caller wins' });
      expect(first.reversal.category).toBe(StaffLedgerCategory.REVERSAL);

      await expect(
        svc.reverse(adminUser, ENTRY_ID, { version: 2, reason: 'second caller loses' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── correct: reversal + fresh corrected entry ───────────────────────────

  describe('correct()', () => {
    it('creates both a REVERSAL and a CORRECTION entry linked to the original', async () => {
      const { svc, tx } = makeService(postedLockedEntry);
      const result = await svc.correct(adminUser, ENTRY_ID, {
        version: 2, reason: 'wrong amount entered', correctedAmount: 750,
      });

      expect(result.reversal.category).toBe(StaffLedgerCategory.REVERSAL);
      expect(result.reversal.amount).toBe(-postedLockedEntry.amount);
      expect(result.reversal.reversedEntryId).toBe(ENTRY_ID);

      expect(result.correction.category).toBe(StaffLedgerCategory.CORRECTION);
      expect(result.correction.amount).toBe(750);
      expect(result.correction.reversedEntryId).toBe(ENTRY_ID);

      expect(tx.staffLedgerEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ENTRY_ID, vendorId: VENDOR_ID, version: 2 },
          data: { version: { increment: 1 } },
        }),
      );

      const auditActions = tx.staffLedgerAuditLog.create.mock.calls.map((c: any) => c[0].data.action);
      expect(auditActions).toEqual([
        StaffLedgerAuditAction.CORRECTED,
        StaffLedgerAuditAction.CORRECTED,
        StaffLedgerAuditAction.CORRECTED,
      ]);
    });

    it('claims the version (CAS) before creating either new row, so a stale version never creates orphan entries', async () => {
      const { svc, tx } = makeService(postedLockedEntry);
      await expect(
        svc.correct(adminUser, ENTRY_ID, { version: 0, reason: 'stale', correctedAmount: 100 }),
      ).rejects.toThrow(ConflictException);
      expect(tx.staffLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('rejects correcting an entry not yet rolled into a locked payroll period', async () => {
      const { svc } = makeService(postedPreLockEntry);
      await expect(
        svc.correct(adminUser, ENTRY_ID, { version: 1, reason: 'too early', correctedAmount: 100 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on stale version', async () => {
      const { svc } = makeService(postedLockedEntry);
      await expect(
        svc.correct(adminUser, ENTRY_ID, { version: 0, reason: 'stale', correctedAmount: 100 }),
      ).rejects.toThrow(ConflictException);
    });

    it('under a concurrent race, the first correct succeeds and the second throws ConflictException', async () => {
      const { svc } = makeService(postedLockedEntry);

      const first = await svc.correct(adminUser, ENTRY_ID, {
        version: 2, reason: 'first caller wins', correctedAmount: 750,
      });
      expect(first.correction.amount).toBe(750);

      await expect(
        svc.correct(adminUser, ENTRY_ID, { version: 2, reason: 'second caller loses', correctedAmount: 900 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── findForEmployee ──────────────────────────────────────────────────────

  describe('findForEmployee()', () => {
    it('scopes the query to vendorId + userId and paginates', async () => {
      const { svc, prisma } = makeService();
      const result = await svc.findForEmployee(adminUser, EMPLOYEE_ID, { page: 1, limit: 20 } as any);

      expect(prisma.staffLedgerEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { vendorId: VENDOR_ID, userId: EMPLOYEE_ID } }),
      );
      expect(result.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 });
    });

    it('throws NotFoundException when the employee does not belong to this vendor', async () => {
      const { svc } = makeService(pendingEntry, false);
      await expect(svc.findForEmployee(adminUser, EMPLOYEE_ID, {} as any)).rejects.toThrow(NotFoundException);
    });

    // ── self-view-only scoping (payroll:view_all) ───────────────────────────

    it('allows a user to view their own ledger with no payroll:view_all permission', async () => {
      const { svc, permissions } = makeService(pendingEntry, true, false); // permissions.can() → false
      const self = { userId: EMPLOYEE_ID, vendorId: VENDOR_ID, role: 'DRIVER' } as any;
      await expect(svc.findForEmployee(self, EMPLOYEE_ID, {} as any)).resolves.toBeDefined();
      expect(permissions.can).not.toHaveBeenCalled(); // short-circuits on self-match, no permission lookup needed
    });

    it('rejects viewing another employee\'s ledger without payroll:view_all', async () => {
      const { svc } = makeService(pendingEntry, true, false); // permissions.can() → false
      await expect(svc.findForEmployee(otherStaffUser, EMPLOYEE_ID, {} as any)).rejects.toThrow(ForbiddenException);
    });

    it('allows viewing another employee\'s ledger with payroll:view_all', async () => {
      const { svc } = makeService(pendingEntry, true, true); // permissions.can() → true
      await expect(svc.findForEmployee(otherStaffUser, EMPLOYEE_ID, {} as any)).resolves.toBeDefined();
    });
  });
});
