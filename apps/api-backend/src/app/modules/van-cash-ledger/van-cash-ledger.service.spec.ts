import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VanCashLedgerService } from './van-cash-ledger.service';
import {
  DailySheetKind,
  DiscrepancyCaseStatus,
  DiscrepancyType,
  ExpenseCategory,
  OfficeCashRemittanceDestination,
  OfficeCashRemittanceStatus,
  VanCashHandoverStatus,
} from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';

// ─── fixtures ───────────────────────────────────────────────────────────────

const VENDOR_ID = 'vendor-001';
const VAN_ID = 'van-001';
const SHEET_ID = 'sheet-001';
const DRIVER_ID = 'driver-001';
const HANDOVER_ID = 'handover-001';

const adminUser: AuthUser = {
  userId: 'admin-001',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'VENDOR_ADMIN',
  vendorId: VENDOR_ID,
  customerId: null,
};

/** A closed-sheet shape compatible with SHEET_CASH_RELOAD_INCLUDE + resolveSheetCash. */
function buildClosedSheet(overrides: Record<string, unknown> = {}) {
  return {
    id: SHEET_ID,
    vendorId: VENDOR_ID,
    vanId: VAN_ID,
    driverId: DRIVER_ID,
    date: new Date('2026-09-01'),
    kind: DailySheetKind.ROUTE,
    isClosed: true,
    cashCollected: 500,
    cashExpected: 500,
    items: [],
    expenses: [],
    crewCashDistributions: [],
    loads: [],
    postCloseExpenseCorrectionCount: 0,
    postCloseCrewCashCorrectionCount: 0,
    ...overrides,
  };
}

const baseHandover = {
  id: HANDOVER_ID,
  vendorId: VENDOR_ID,
  vanId: VAN_ID,
  dailySheetId: SHEET_ID,
  amount: 500,
  submittedById: DRIVER_ID,
  date: new Date('2026-09-01'),
  status: VanCashHandoverStatus.PENDING as VanCashHandoverStatus,
  approvedById: null as string | null,
  approvedAt: null as Date | null,
  approvedAmount: null as number | null,
  adjustmentReason: null as string | null,
  correctsEntryId: null as string | null,
  version: 1,
  createdAt: new Date('2026-09-01'),
  updatedAt: new Date('2026-09-01'),
};

// ─── mock tx / prisma factory ───────────────────────────────────────────────

function makeTx(opts: {
  sheet?: Record<string, unknown> | null;
  handover?: typeof baseHandover | null;
  chain?: (typeof baseHandover)[];
  existingHandover?: typeof baseHandover | null;
  discrepancy?: { id: string } | null;
} = {}) {
  const {
    sheet = buildClosedSheet(),
    handover = null,
    chain = [],
    existingHandover = null,
    discrepancy = null,
  } = opts;

  let current = handover ? { ...handover } : null;

  return {
    dailySheet: {
      findUnique: jest.fn().mockImplementation(async () => sheet),
    },
    vanCashHandover: {
      findFirst: jest.fn().mockImplementation(async (args: any) => {
        if (args?.where?.correctsEntryId === null && !current) return existingHandover;
        if (current && args?.where?.id === current.id) return { ...current };
        return existingHandover;
      }),
      findMany: jest.fn().mockImplementation(async () => chain.map((r) => ({ ...r }))),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'new-handover-001',
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      })),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        if (current && where.id === current.id) current = { ...current, ...data };
        return { ...current };
      }),
      updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
        if (!current || where.version !== current.version) return { count: 0 };
        const versionBump = data.version?.increment ?? 0;
        current = { ...current, ...data, version: current.version + versionBump };
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...current })),
    },
    sheetDiscrepancyCase: {
      findFirst: jest.fn().mockResolvedValue(discrepancy),
    },
  };
}

function makeService(txOpts: Parameters<typeof makeTx>[0] = {}) {
  const tx = makeTx(txOpts);
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    vanCashHandover: {
      findFirst: tx.vanCashHandover.findFirst,
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const permissions = { can: jest.fn().mockResolvedValue(true) };
  const svc = new VanCashLedgerService(prisma as any, audit as any, permissions as any);
  return { svc, prisma, tx, audit, permissions };
}

// ─── Office Cash Remittance fixtures + factory ──────────────────────────────

const REMITTANCE_ID = 'remit-001';

const baseRemittance = {
  id: REMITTANCE_ID,
  vendorId: VENDOR_ID,
  submittedAmount: 5000,
  amount: 5000,
  date: new Date('2026-09-10'),
  destination: OfficeCashRemittanceDestination.OWNER,
  destinationName: null as string | null,
  reference: null as string | null,
  attachmentKey: null as string | null,
  note: null as string | null,
  status: OfficeCashRemittanceStatus.PENDING as OfficeCashRemittanceStatus,
  submittedById: 'accountant-001',
  approvedById: null as string | null,
  approvedAt: null as Date | null,
  approvedAmount: null as number | null,
  adjustmentReason: null as string | null,
  negativeOverrideReason: null as string | null,
  voidedById: null as string | null,
  voidedAt: null as Date | null,
  voidReason: null as string | null,
  correctsEntryId: null as string | null,
  version: 1,
  createdAt: new Date('2026-09-10'),
  updatedAt: new Date('2026-09-10'),
};

type Remittance = typeof baseRemittance;

/**
 * Focused factory for the Office Cash Remittance methods. `computeAvailableBalance`
 * is spied (not mocked at the DB layer) so a test can dial the office cash
 * position directly.
 */
function makeRemittanceService(opts: {
  remittance?: Remittance | null;
  chain?: Remittance[];
  available?: number;
  liveCorrection?: { id: string } | null;
  canRemitVoid?: boolean;
  canRemitApprove?: boolean;
} = {}) {
  const {
    remittance = null,
    chain = [],
    available = 100000,
    liveCorrection = null,
    canRemitVoid = true,
    canRemitApprove = true,
  } = opts;

  // Single mutable store keyed by id, seeded from `chain` + any standalone row,
  // so `update` / `updateMany` / `findUniqueOrThrow` all agree.
  const rows = new Map<string, Remittance>();
  for (const r of chain) rows.set(r.id, { ...r });
  if (remittance) rows.set(remittance.id, { ...remittance });
  let lastTouchedId: string | null =
    remittance?.id ?? (chain.length === 1 ? chain[0].id : null);

  const officeCashRemittance = {
    findFirst: jest.fn().mockImplementation(async (args: any) => {
      const w = args?.where ?? {};
      // voidRemittance's live-correction probe: { vendorId, correctsEntryId, status: { not } }
      if (w.correctsEntryId !== undefined && w.status !== undefined) return liveCorrection;
      // loadRemittanceChain walk-down: { correctsEntryId: tip.id, vendorId }
      if (w.correctsEntryId !== undefined) {
        return [...rows.values()].find((r) => r.correctsEntryId === w.correctsEntryId) ?? null;
      }
      if (w.id !== undefined) {
        const r = rows.get(w.id);
        return r ? { ...r } : null;
      }
      return null;
    }),
    findUniqueOrThrow: jest.fn().mockImplementation(async ({ where }: any = {}) => {
      const r = rows.get(where?.id ?? lastTouchedId ?? '');
      if (!r) throw new Error('not found');
      return { ...r };
    }),
    create: jest.fn().mockImplementation(async ({ data }: any) => {
      const row = {
        id: 'new-remit-001',
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        destinationName: null,
        reference: null,
        attachmentKey: null,
        note: null,
        approvedById: null,
        approvedAt: null,
        approvedAmount: null,
        adjustmentReason: null,
        negativeOverrideReason: null,
        voidedById: null,
        voidedAt: null,
        voidReason: null,
        correctsEntryId: null,
        ...data,
      } as Remittance;
      rows.set(row.id, row);
      lastTouchedId = row.id;
      return { ...row };
    }),
    update: jest.fn().mockImplementation(async ({ where, data }: any) => {
      const base = rows.get(where.id);
      if (!base) throw new Error('not found');
      const bump = data.version?.increment ?? 0;
      const updated = { ...base, ...data, version: (base.version ?? 1) + bump } as Remittance;
      rows.set(where.id, updated);
      lastTouchedId = where.id;
      return { ...updated };
    }),
    updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
      const base = rows.get(where.id);
      if (!base || (where.version !== undefined && where.version !== base.version)) return { count: 0 };
      const bump = data.version?.increment ?? 0;
      rows.set(where.id, { ...base, ...data, version: base.version + bump } as Remittance);
      lastTouchedId = where.id;
      return { count: 1 };
    }),
  };

  const tx = { officeCashRemittance };
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    officeCashRemittance,
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const grants = new Set<string>();
  if (canRemitApprove) grants.add('van_cash_ledger:remit_approve');
  if (canRemitVoid) grants.add('van_cash_ledger:remit_void');
  const permissions = {
    can: jest.fn().mockImplementation(async (_uid: string, perm: string) => grants.has(perm)),
  };
  const svc = new VanCashLedgerService(prisma as any, audit as any, permissions as any);
  const computeSpy = jest
    .spyOn(svc as any, 'computeAvailableBalance')
    .mockResolvedValue(available);
  return { svc, prisma, tx, audit, permissions, computeSpy };
}

const accountantUser: AuthUser = {
  userId: 'accountant-001',
  email: 'acc@example.com',
  name: 'Accountant',
  role: 'STAFF',
  vendorId: VENDOR_ID,
  customerId: null,
};

const managerUser: AuthUser = {
  userId: 'manager-001',
  email: 'mgr@example.com',
  name: 'Manager',
  role: 'STAFF',
  vendorId: VENDOR_ID,
  customerId: null,
};

// ─── tests ──────────────────────────────────────────────────────────────────

describe('VanCashLedgerService', () => {
  describe('createHandoverForClosedSheet()', () => {
    it('creates a PENDING handover for a ROUTE sheet using resolveSheetCash().cashExpected', async () => {
      const { svc, tx } = makeService({ sheet: buildClosedSheet({ cashExpected: 750 }) });

      const result = await svc.createHandoverForClosedSheet(tx as any, VENDOR_ID, SHEET_ID);

      expect(tx.vanCashHandover.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            vendorId: VENDOR_ID,
            vanId: VAN_ID,
            dailySheetId: SHEET_ID,
            amount: 750,
            submittedById: DRIVER_ID,
            status: VanCashHandoverStatus.PENDING,
            approvedAt: null,
            approvedById: null,
          }),
        }),
      );
      expect(result).not.toBeNull();
    });

    it('auto-approves a WALK_IN sheet handover', async () => {
      const { svc, tx } = makeService({ sheet: buildClosedSheet({ kind: DailySheetKind.WALK_IN }) });

      await svc.createHandoverForClosedSheet(tx as any, VENDOR_ID, SHEET_ID);

      expect(tx.vanCashHandover.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: VanCashHandoverStatus.APPROVED,
            approvedById: null,
          }),
        }),
      );
      const call = tx.vanCashHandover.create.mock.calls[0][0];
      expect(call.data.approvedAt).toBeInstanceOf(Date);
    });

    it('skips creation when the resolved cash figure is 0 (no meaningful cash event)', async () => {
      const { svc, tx } = makeService({ sheet: buildClosedSheet({ cashExpected: 0 }) });

      const result = await svc.createHandoverForClosedSheet(tx as any, VENDOR_ID, SHEET_ID);

      expect(result).toBeNull();
      expect(tx.vanCashHandover.create).not.toHaveBeenCalled();
    });

    it('is idempotent — returns the existing original handover instead of creating a second one', async () => {
      const existing = { ...baseHandover };
      const { svc, tx } = makeService({ existingHandover: existing });

      const result = await svc.createHandoverForClosedSheet(tx as any, VENDOR_ID, SHEET_ID);

      expect(tx.vanCashHandover.create).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    it('returns null when the sheet cannot be found', async () => {
      const { svc, tx } = makeService({ sheet: null });
      const result = await svc.createHandoverForClosedSheet(tx as any, VENDOR_ID, SHEET_ID);
      expect(result).toBeNull();
    });
  });

  describe('handlePostCloseCorrection()', () => {
    it('updates the PENDING original handover amount in place (nothing was ever approved)', async () => {
      const { svc, tx } = makeService({ handover: { ...baseHandover, status: VanCashHandoverStatus.PENDING }, chain: [baseHandover] });

      const result = await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 800);

      expect(tx.vanCashHandover.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: HANDOVER_ID },
          data: expect.objectContaining({ amount: 800, version: { increment: 1 } }),
        }),
      );
      expect(tx.vanCashHandover.create).not.toHaveBeenCalled();
      expect(result?.amount).toBe(800);
    });

    it('creates a new correction row carrying the DELTA when the original is APPROVED', async () => {
      const approved = { ...baseHandover, status: VanCashHandoverStatus.APPROVED, approvedAt: new Date() };
      const { svc, tx } = makeService({ chain: [approved] });

      const result = await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 800);

      expect(tx.vanCashHandover.update).not.toHaveBeenCalled();
      expect(tx.vanCashHandover.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dailySheetId: SHEET_ID,
            amount: 300, // delta = 800 - 500
            correctsEntryId: HANDOVER_ID,
            status: VanCashHandoverStatus.APPROVED,
            approvedById: null,
          }),
        }),
      );
      expect(result?.amount).toBe(300);
    });

    it('creates a NEGATIVE delta correction row when the new amount is lower than the current total', async () => {
      const approved = { ...baseHandover, status: VanCashHandoverStatus.APPROVED, approvedAt: new Date() };
      const { svc, tx } = makeService({ chain: [approved] });

      await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 200);

      expect(tx.vanCashHandover.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: -300 }) }),
      );
    });

    it('is a no-op when the delta is 0', async () => {
      const approved = { ...baseHandover, status: VanCashHandoverStatus.APPROVED };
      const { svc, tx } = makeService({ chain: [approved] });

      const result = await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 500);

      expect(result).toBeNull();
      expect(tx.vanCashHandover.create).not.toHaveBeenCalled();
      expect(tx.vanCashHandover.update).not.toHaveBeenCalled();
    });

    it('seeds a fresh handover when none exists yet and the corrected amount is non-zero', async () => {
      const { svc, tx } = makeService({ chain: [], sheet: buildClosedSheet() });

      const result = await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 400);

      expect(tx.vanCashHandover.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 400, status: VanCashHandoverStatus.PENDING, dailySheetId: SHEET_ID }),
        }),
      );
      expect(result?.amount).toBe(400);
    });

    it('does nothing when no handover exists and the corrected amount is 0', async () => {
      const { svc, tx } = makeService({ chain: [] });
      const result = await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 0);
      expect(result).toBeNull();
      expect(tx.vanCashHandover.create).not.toHaveBeenCalled();
    });

    it('appends a further correction row on top of an existing correction chain', async () => {
      const original = { ...baseHandover, status: VanCashHandoverStatus.APPROVED };
      const firstCorrection = {
        ...baseHandover,
        id: 'correction-001',
        amount: 100,
        correctsEntryId: HANDOVER_ID,
        status: VanCashHandoverStatus.APPROVED,
      };
      const { svc, tx } = makeService({ chain: [original, firstCorrection] });

      // currentTotal = 500 + 100 = 600; new = 650 => delta 50
      await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 650);

      expect(tx.vanCashHandover.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 50, correctsEntryId: 'correction-001' }),
        }),
      );
    });
  });

  describe('approveHandover()', () => {
    it('approves a PENDING handover with no adjustment', async () => {
      const { svc, tx } = makeService({ handover: { ...baseHandover, version: 1 } });

      const result = await svc.approveHandover(adminUser, HANDOVER_ID, { version: 1 });

      expect(tx.vanCashHandover.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: HANDOVER_ID, vendorId: VENDOR_ID, version: 1 },
          data: expect.objectContaining({
            status: VanCashHandoverStatus.APPROVED,
            approvedById: adminUser.userId,
            approvedAmount: 500,
          }),
        }),
      );
      expect(result.status).toBe(VanCashHandoverStatus.APPROVED);
    });

    it('throws NotFoundException when the handover does not belong to this vendor', async () => {
      const { svc } = makeService({ handover: null });
      await expect(svc.approveHandover(adminUser, HANDOVER_ID, { version: 1 })).rejects.toThrow(NotFoundException);
    });

    it('rejects approving a non-PENDING handover', async () => {
      const { svc } = makeService({ handover: { ...baseHandover, status: VanCashHandoverStatus.APPROVED } });
      await expect(svc.approveHandover(adminUser, HANDOVER_ID, { version: 1 })).rejects.toThrow(BadRequestException);
    });

    it('blocks approval when an unresolved CASH discrepancy case exists for the sheet', async () => {
      const { svc, tx } = makeService({
        handover: { ...baseHandover, version: 1 },
        discrepancy: { id: 'disc-001' },
      });

      await expect(svc.approveHandover(adminUser, HANDOVER_ID, { version: 1 })).rejects.toThrow(BadRequestException);
      expect(tx.sheetDiscrepancyCase.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            dailySheetId: SHEET_ID,
            type: DiscrepancyType.CASH,
            status: DiscrepancyCaseStatus.REPORTED,
          }),
        }),
      );
    });

    it('requires adjustmentReason when approvedAmount differs from the handover amount', async () => {
      const { svc } = makeService({ handover: { ...baseHandover, version: 1 } });
      await expect(
        svc.approveHandover(adminUser, HANDOVER_ID, { version: 1, approvedAmount: 450 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a different approvedAmount when adjustmentReason is provided', async () => {
      const { svc, tx } = makeService({ handover: { ...baseHandover, version: 1 } });
      const result = await svc.approveHandover(adminUser, HANDOVER_ID, {
        version: 1,
        approvedAmount: 450,
        adjustmentReason: 'recount',
      });
      expect(tx.vanCashHandover.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ approvedAmount: 450, adjustmentReason: 'recount' }) }),
      );
      expect(result.approvedAmount).toBe(450);
    });

    it('throws ConflictException on stale version (CAS mismatch)', async () => {
      const { svc } = makeService({ handover: { ...baseHandover, version: 5 } });
      await expect(svc.approveHandover(adminUser, HANDOVER_ID, { version: 1 })).rejects.toThrow(ConflictException);
    });
  });

  // ─── Office Cash Remittance ───────────────────────────────────────────────

  describe('createRemittance()', () => {
    it('creates a PENDING remittance and audits it', async () => {
      const { svc, prisma, audit } = makeRemittanceService({ available: 50000 });

      const result = await svc.createRemittance(accountantUser, {
        amount: 8000,
        date: '2026-09-10',
        destination: OfficeCashRemittanceDestination.OWNER,
      });

      expect(prisma.officeCashRemittance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            vendorId: VENDOR_ID,
            // C1: submittedAmount is seeded equal to the requested amount.
            submittedAmount: 8000,
            amount: 8000,
            status: OfficeCashRemittanceStatus.PENDING,
            submittedById: accountantUser.userId,
          }),
        }),
      );
      expect(result.wouldGoNegative).toBe(false);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATED', entity: 'OfficeCashRemittance' }));
    });

    it('flags wouldGoNegative but still creates the row when a note is provided', async () => {
      const { svc, prisma } = makeRemittanceService({ available: 3000 });

      const result = await svc.createRemittance(accountantUser, {
        amount: 8000,
        date: '2026-09-10',
        destination: OfficeCashRemittanceDestination.BANK,
        note: 'a van handover is still pending entry',
      });

      expect(result.wouldGoNegative).toBe(true);
      expect(prisma.officeCashRemittance.create).toHaveBeenCalled();
    });

    it('M5: rejects an over-remittance recorded without a note', async () => {
      const { svc, prisma } = makeRemittanceService({ available: 3000 });

      await expect(
        svc.createRemittance(accountantUser, {
          amount: 8000,
          date: '2026-09-10',
          destination: OfficeCashRemittanceDestination.BANK,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.officeCashRemittance.create).not.toHaveBeenCalled();
    });
  });

  describe('approveRemittance()', () => {
    it('approves a PENDING remittance with no adjustment', async () => {
      const { svc, tx } = makeRemittanceService({
        remittance: { ...baseRemittance, version: 1 },
        available: 100000,
      });

      const result = await svc.approveRemittance(managerUser, REMITTANCE_ID, { version: 1 });

      expect(tx.officeCashRemittance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: REMITTANCE_ID, vendorId: VENDOR_ID, version: 1 },
          data: expect.objectContaining({
            status: OfficeCashRemittanceStatus.APPROVED,
            approvedById: managerUser.userId,
            approvedAmount: 5000,
            amount: 5000,
          }),
        }),
      );
      expect(result.status).toBe(OfficeCashRemittanceStatus.APPROVED);
    });

    it('blocks the recorder from approving their own remittance', async () => {
      const { svc } = makeRemittanceService({ remittance: { ...baseRemittance, submittedById: managerUser.userId } });
      await expect(
        svc.approveRemittance(managerUser, REMITTANCE_ID, { version: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects approving a non-PENDING remittance', async () => {
      const { svc } = makeRemittanceService({
        remittance: { ...baseRemittance, status: OfficeCashRemittanceStatus.APPROVED },
      });
      await expect(svc.approveRemittance(managerUser, REMITTANCE_ID, { version: 1 })).rejects.toThrow(BadRequestException);
    });

    it('requires adjustmentReason when approvedAmount differs from the amount', async () => {
      const { svc } = makeRemittanceService({ remittance: { ...baseRemittance, version: 1 } });
      await expect(
        svc.approveRemittance(managerUser, REMITTANCE_ID, { version: 1, approvedAmount: 4500 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks an approval that drives office cash negative unless negativeOverrideReason is given', async () => {
      const { svc } = makeRemittanceService({ remittance: { ...baseRemittance, version: 1 }, available: 3000 });
      await expect(
        svc.approveRemittance(managerUser, REMITTANCE_ID, { version: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a negative-driving approval when negativeOverrideReason is provided', async () => {
      const { svc, tx } = makeRemittanceService({ remittance: { ...baseRemittance, version: 1 }, available: 3000 });
      const result = await svc.approveRemittance(managerUser, REMITTANCE_ID, {
        version: 1,
        negativeOverrideReason: 'van handover still pending entry',
      });
      expect(tx.officeCashRemittance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ negativeOverrideReason: 'van handover still pending entry' }),
        }),
      );
      expect(result.status).toBe(OfficeCashRemittanceStatus.APPROVED);
    });

    it('throws ConflictException on stale version', async () => {
      const { svc } = makeRemittanceService({ remittance: { ...baseRemittance, version: 5 } });
      await expect(svc.approveRemittance(managerUser, REMITTANCE_ID, { version: 1 })).rejects.toThrow(ConflictException);
    });

    it('C1: an adjusted approval sets amount + approvedAmount but never touches submittedAmount', async () => {
      const { svc, tx } = makeRemittanceService({
        remittance: { ...baseRemittance, version: 1, submittedAmount: 5000, amount: 5000 },
      });

      const result = await svc.approveRemittance(managerUser, REMITTANCE_ID, {
        version: 1,
        approvedAmount: 4500,
        adjustmentReason: 'short by 500 on recount',
      });

      const data = tx.officeCashRemittance.updateMany.mock.calls[0][0].data;
      expect(data.amount).toBe(4500);
      expect(data.approvedAmount).toBe(4500);
      expect(data).not.toHaveProperty('submittedAmount');
      expect(result.submittedAmount).toBe(5000);
      expect(result.amount).toBe(4500);
    });
  });

  describe('voidRemittance()', () => {
    it('voids a PENDING remittance (status flip + reason + audit)', async () => {
      const { svc, tx, audit } = makeRemittanceService({ remittance: { ...baseRemittance, version: 1 } });

      const result = await svc.voidRemittance(accountantUser, REMITTANCE_ID, {
        version: 1,
        voidReason: 'entered by mistake',
      });

      expect(tx.officeCashRemittance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OfficeCashRemittanceStatus.VOIDED,
            voidedById: accountantUser.userId,
            voidReason: 'entered by mistake',
          }),
        }),
      );
      expect(result.status).toBe(OfficeCashRemittanceStatus.VOIDED);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'VOIDED', entity: 'OfficeCashRemittance' }));
    });

    it('blocks voiding an APPROVED remittance without van_cash_ledger:remit_void', async () => {
      const { svc } = makeRemittanceService({
        remittance: { ...baseRemittance, version: 1, status: OfficeCashRemittanceStatus.APPROVED },
        canRemitVoid: false,
      });
      await expect(
        svc.voidRemittance(managerUser, REMITTANCE_ID, { version: 1, voidReason: 'wrong amount entirely' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks voiding an APPROVED remittance that still has a live correction', async () => {
      const { svc } = makeRemittanceService({
        remittance: { ...baseRemittance, version: 1, status: OfficeCashRemittanceStatus.APPROVED },
        canRemitVoid: true,
        liveCorrection: { id: 'correction-001' },
      });
      await expect(
        svc.voidRemittance(managerUser, REMITTANCE_ID, { version: 1, voidReason: 'needs full reversal' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects double-void', async () => {
      const { svc } = makeRemittanceService({
        remittance: { ...baseRemittance, version: 1, status: OfficeCashRemittanceStatus.VOIDED },
      });
      await expect(
        svc.voidRemittance(managerUser, REMITTANCE_ID, { version: 1, voidReason: 'already gone though' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on stale version', async () => {
      const { svc } = makeRemittanceService({ remittance: { ...baseRemittance, version: 5 } });
      await expect(
        svc.voidRemittance(accountantUser, REMITTANCE_ID, { version: 1, voidReason: 'stale token retry' }),
      ).rejects.toThrow(ConflictException);
    });

    it('M1: a creator may void their OWN pending remittance with no approver/void grant', async () => {
      const { svc, tx } = makeRemittanceService({
        remittance: { ...baseRemittance, version: 1, submittedById: accountantUser.userId },
        canRemitApprove: false,
        canRemitVoid: false,
      });

      const result = await svc.voidRemittance(accountantUser, REMITTANCE_ID, {
        version: 1,
        voidReason: 'recorded the wrong bank',
      });

      expect(result.status).toBe(OfficeCashRemittanceStatus.VOIDED);
      expect(tx.officeCashRemittance.updateMany).toHaveBeenCalled();
    });

    it('M1: blocks a non-creator without remit_approve from voiding a pending remittance', async () => {
      const { svc } = makeRemittanceService({
        remittance: { ...baseRemittance, version: 1, submittedById: 'someone-else-001' },
        canRemitApprove: false,
        canRemitVoid: false,
      });

      await expect(
        svc.voidRemittance(managerUser, REMITTANCE_ID, { version: 1, voidReason: 'not mine to void' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('correctRemittance()', () => {
    it('M2: rewrites a still-PENDING standalone remittance in place via a version CAS', async () => {
      const root = { ...baseRemittance, version: 2, status: OfficeCashRemittanceStatus.PENDING };
      const { svc, tx } = makeRemittanceService({ chain: [root] });

      const result = await svc.correctRemittance(accountantUser, REMITTANCE_ID, {
        version: 2,
        newAmount: 6500,
        correctionReason: 'typo in the amount',
      });

      // Plain update() must NOT be used — the in-place branch is a CAS updateMany
      // keyed on { id, vendorId, version }.
      expect(tx.officeCashRemittance.update).not.toHaveBeenCalled();
      expect(tx.officeCashRemittance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: REMITTANCE_ID, vendorId: VENDOR_ID, version: 2 },
          data: expect.objectContaining({ amount: 6500, version: { increment: 1 } }),
        }),
      );
      expect(tx.officeCashRemittance.create).not.toHaveBeenCalled();
      expect(result.amount).toBe(6500);
    });

    it('M2: an in-place correction rejects a stale version when the CAS matches no row', async () => {
      const root = { ...baseRemittance, version: 2, status: OfficeCashRemittanceStatus.PENDING };
      const { svc, tx } = makeRemittanceService({ chain: [root] });
      // Simulate a concurrent bump: the CAS matches 0 rows.
      tx.officeCashRemittance.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        svc.correctRemittance(accountantUser, REMITTANCE_ID, {
          version: 2,
          newAmount: 6500,
          correctionReason: 'lost the race to a concurrent edit',
        }),
      ).rejects.toThrow(ConflictException);
      expect(tx.officeCashRemittance.create).not.toHaveBeenCalled();
    });

    it('appends a PENDING DELTA row when the original is APPROVED', async () => {
      const root = { ...baseRemittance, version: 3, status: OfficeCashRemittanceStatus.APPROVED };
      const { svc, tx } = makeRemittanceService({ chain: [root] });

      const result = await svc.correctRemittance(managerUser, REMITTANCE_ID, {
        version: 3,
        newAmount: 6500,
        correctionReason: 'bank credited more than recorded',
      });

      expect(tx.officeCashRemittance.update).not.toHaveBeenCalled();
      expect(tx.officeCashRemittance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            // C1: a delta row's submittedAmount is the proposed delta.
            submittedAmount: 1500,
            amount: 1500, // 6500 - 5000
            status: OfficeCashRemittanceStatus.PENDING,
            correctsEntryId: REMITTANCE_ID,
            submittedById: managerUser.userId,
          }),
        }),
      );
      expect(result.amount).toBe(1500);
    });

    it('M3: a concurrent correction of the same parent is rejected and creates no child', async () => {
      const root = { ...baseRemittance, version: 3, status: OfficeCashRemittanceStatus.APPROVED };
      const { svc, tx } = makeRemittanceService({ chain: [root] });
      // The parent-claim CAS (bump mostRecent.version) matches 0 rows — another
      // correction already advanced it.
      tx.officeCashRemittance.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        svc.correctRemittance(managerUser, REMITTANCE_ID, {
          version: 3,
          newAmount: 6500,
          correctionReason: 'two approvers corrected at once',
        }),
      ).rejects.toThrow(ConflictException);
      expect(tx.officeCashRemittance.create).not.toHaveBeenCalled();
    });

    it('M1: a creator may correct their OWN pending remittance in place with no approver grant', async () => {
      const root = {
        ...baseRemittance,
        version: 2,
        status: OfficeCashRemittanceStatus.PENDING,
        submittedById: accountantUser.userId,
      };
      const { svc, tx } = makeRemittanceService({ chain: [root], canRemitApprove: false });

      const result = await svc.correctRemittance(accountantUser, REMITTANCE_ID, {
        version: 2,
        newAmount: 6500,
        correctionReason: 'fixing my own entry before approval',
      });

      expect(tx.officeCashRemittance.updateMany).toHaveBeenCalled();
      expect(result.amount).toBe(6500);
    });

    it('M1: blocks a non-creator without remit_approve from correcting a pending remittance', async () => {
      const root = {
        ...baseRemittance,
        version: 2,
        status: OfficeCashRemittanceStatus.PENDING,
        submittedById: 'someone-else-001',
      };
      const { svc } = makeRemittanceService({ chain: [root], canRemitApprove: false });

      await expect(
        svc.correctRemittance(managerUser, REMITTANCE_ID, {
          version: 2,
          newAmount: 6500,
          correctionReason: 'not my entry to touch',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('M1: correcting an APPROVED remittance requires remit_approve', async () => {
      const root = { ...baseRemittance, version: 3, status: OfficeCashRemittanceStatus.APPROVED };
      const { svc } = makeRemittanceService({ chain: [root], canRemitApprove: false });

      await expect(
        svc.correctRemittance(accountantUser, REMITTANCE_ID, {
          version: 3,
          newAmount: 6500,
          correctionReason: 'approved rows are not self-service',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a NEGATIVE delta row when correcting an approved remittance downward', async () => {
      const root = { ...baseRemittance, version: 3, status: OfficeCashRemittanceStatus.APPROVED };
      const { svc, tx } = makeRemittanceService({ chain: [root] });

      await svc.correctRemittance(managerUser, REMITTANCE_ID, {
        version: 3,
        newAmount: 2000,
        correctionReason: 'over-recorded by three thousand',
      });

      expect(tx.officeCashRemittance.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: -3000 }) }),
      );
    });

    it('appends onto an existing correction chain (delta vs current total)', async () => {
      const root = { ...baseRemittance, id: 'root-1', version: 1, status: OfficeCashRemittanceStatus.APPROVED };
      const c1 = {
        ...baseRemittance,
        id: 'corr-1',
        amount: 1000,
        version: 1,
        status: OfficeCashRemittanceStatus.APPROVED,
        correctsEntryId: 'root-1',
      };
      const { svc, tx } = makeRemittanceService({ chain: [root, c1] });

      // currentTotal = 5000 + 1000 = 6000; newAmount 6800 => delta 800
      await svc.correctRemittance(managerUser, 'root-1', {
        version: 1,
        newAmount: 6800,
        correctionReason: 'final reconciliation adjustment',
      });

      expect(tx.officeCashRemittance.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 800, correctsEntryId: 'corr-1' }) }),
      );
    });

    it('rejects a no-op correction (delta 0)', async () => {
      const root = { ...baseRemittance, version: 2, status: OfficeCashRemittanceStatus.PENDING };
      const { svc } = makeRemittanceService({ chain: [root] });
      await expect(
        svc.correctRemittance(accountantUser, REMITTANCE_ID, {
          version: 2,
          newAmount: 5000,
          correctionReason: 'no actual change here',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on stale version', async () => {
      const root = { ...baseRemittance, version: 9, status: OfficeCashRemittanceStatus.PENDING };
      const { svc } = makeRemittanceService({ chain: [root] });
      await expect(
        svc.correctRemittance(accountantUser, REMITTANCE_ID, {
          version: 1,
          newAmount: 6000,
          correctionReason: 'stale token on correct',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('normalizeRemittanceOut() — M4', () => {
    it('flags DELTA correction rows via isCorrection so the UI keeps "Correct" off them', () => {
      const { svc } = makeRemittanceService();
      const base = {
        ...baseRemittance,
        status: OfficeCashRemittanceStatus.APPROVED,
        submittedBy: null,
        approvedBy: null,
        voidedBy: null,
      };
      const root = (svc as any).normalizeRemittanceOut({ ...base, correctsEntryId: null });
      const delta = (svc as any).normalizeRemittanceOut({ ...base, correctsEntryId: 'root-1' });
      expect(root.isCorrection).toBe(false);
      expect(delta.isCorrection).toBe(true);
    });
  });

  // ─── Cash-out scope: sheet-linked expenses / crew cash are NOT deducted ────
  // They are already netted out of the sheet's VanCashHandover.amount
  // (= resolveSheetCash().cashExpected = netToHandIn). Folding them in here too
  // would double-count. Only Expense-Center-direct (dailySheetId: null) rows +
  // office StaffLedgerEntry are office cash-out.

  describe('cash-out scope', () => {
    const AGG0 = { _sum: { amount: null, openingBalance: null } };

    function makeLedgerReadService(overrides: Record<string, any> = {}) {
      const prisma: any = {
        vanCashHandover: {
          aggregate: jest.fn().mockResolvedValue(AGG0),
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        vanCashOpeningBalance: {
          aggregate: jest.fn().mockResolvedValue(AGG0),
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
        expense: {
          aggregate: jest.fn().mockResolvedValue(AGG0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        staffLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
        crewCashDistribution: {
          aggregate: jest.fn().mockResolvedValue(AGG0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        officeCashRemittance: {
          aggregate: jest.fn().mockResolvedValue(AGG0),
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        van: { findUnique: jest.fn().mockResolvedValue(null) },
        ...overrides,
      };
      const audit = { log: jest.fn().mockResolvedValue(undefined) };
      const permissions = { can: jest.fn().mockResolvedValue(true) };
      const svc = new VanCashLedgerService(prisma, audit as any, permissions as any);
      return { svc, prisma };
    }

    it('getStats: the expense cash-out aggregate filters dailySheetId: null and CrewCashDistribution is not queried', async () => {
      const { svc, prisma } = makeLedgerReadService();
      await svc.getStats(VENDOR_ID, {});
      expect(prisma.expense.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ paidFromCash: true, dailySheetId: null }),
        }),
      );
      expect(prisma.crewCashDistribution.aggregate).not.toHaveBeenCalled();
    });

    it('getTimeline: the expense source filters dailySheetId: null and CrewCashDistribution is not queried', async () => {
      const { svc, prisma } = makeLedgerReadService();
      await svc.getTimeline(VENDOR_ID, {});
      expect(prisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ paidFromCash: true, dailySheetId: null }),
        }),
      );
      expect(prisma.crewCashDistribution.findMany).not.toHaveBeenCalled();
    });

    it('getTimeline: an office (dailySheetId: null) cash expense is folded once as a -amount cash-out row', async () => {
      const officeExpense = {
        id: 'exp-office',
        category: ExpenseCategory.OTHER,
        amount: 300,
        paidFromCash: true,
        description: 'Stationery',
        date: new Date('2026-09-10'),
        dailySheetId: null,
        fuelLog: null,
        vehicleServiceRecord: null,
        van: null,
        createdBy: { name: 'Accountant' },
        dailySheet: null,
      };
      const { svc } = makeLedgerReadService({
        expense: {
          aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 300 } }),
          findMany: jest.fn().mockResolvedValue([officeExpense]),
        },
      });

      const page = await svc.getTimeline(VENDOR_ID, {});
      const row = page.data.find((r) => r.sourceRecordId === 'exp-office');
      expect(row).toBeDefined();
      expect(row?.amount).toBe(-300);
      expect(row?.runningBalance).toBe(-300); // moved down by 300 exactly once
    });
  });
});
