import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VanCashLedgerService } from './van-cash-ledger.service';
import { periodLabelOf, redirectDateForToday } from './cash-ledger-period.util';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EditManualCashInDto } from './dto/edit-manual-cash-in.dto';
import { VoidManualCashInDto } from './dto/void-manual-cash-in.dto';
import { AddCashInDto } from './dto/add-cash-in.dto';
import { vendorDateString } from '../../common/helpers/date.util';
import {
  DailySheetKind,
  DiscrepancyCaseStatus,
  DiscrepancyType,
  ExpenseCategory,
  ManualCashInSource,
  ManualCashInStatus,
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
  expectedAmount: 500,
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

/** Period-store stub: `closed` = "YYYY-MM" labels that are CLOSED (default none). */
function makePeriodStore(closed: string[] = []) {
  const set = new Set(closed);
  return {
    getClosedLabels: jest.fn().mockImplementation(async () => new Set(set)),
    closedLabelsAmong: jest
      .fn()
      .mockImplementation(async (_v: string, dates: Array<Date | string>) =>
        [...new Set(dates.map((d) => periodLabelOf(d)))].filter((l) => set.has(l)),
      ),
    isDateClosed: jest.fn().mockImplementation(async (_v: string, d: Date | string) => set.has(periodLabelOf(d))),
  };
}

function makeService(txOpts: Parameters<typeof makeTx>[0] = {}, closedPeriods: string[] = []) {
  const tx = makeTx(txOpts);
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    vanCashHandover: {
      findFirst: tx.vanCashHandover.findFirst,
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const permissions = { can: jest.fn().mockResolvedValue(true) };
  const periodStore = makePeriodStore(closedPeriods);
  const svc = new VanCashLedgerService(
    prisma as any,
    audit as any,
    permissions as any,
    { assertWritable: jest.fn().mockResolvedValue(undefined) } as any,
    periodStore as any,
  );
  return { svc, prisma, tx, audit, permissions, periodStore };
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
  const periodGuard = { assertWritable: jest.fn().mockResolvedValue(undefined) };
  const svc = new VanCashLedgerService(prisma as any, audit as any, permissions as any, periodGuard as any, { getClosedLabels: jest.fn().mockResolvedValue(new Set()), closedLabelsAmong: jest.fn().mockResolvedValue([]), isDateClosed: jest.fn().mockResolvedValue(false) } as any);
  const computeSpy = jest
    .spyOn(svc as any, 'computeAvailableBalance')
    .mockResolvedValue(available);
  return { svc, prisma, tx, audit, permissions, computeSpy, periodGuard };
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
            expectedAmount: 750,
            submittedById: DRIVER_ID,
            status: VanCashHandoverStatus.PENDING,
            approvedAt: null,
            approvedById: null,
          }),
        }),
      );
      expect(result).not.toBeNull();
    });

    it('a WALK_IN sheet handover is PENDING too — same review flow as ROUTE (client denied auto-approve 2026-09-11)', async () => {
      const { svc, tx } = makeService({ sheet: buildClosedSheet({ kind: DailySheetKind.WALK_IN }) });

      await svc.createHandoverForClosedSheet(tx as any, VENDOR_ID, SHEET_ID);

      expect(tx.vanCashHandover.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: VanCashHandoverStatus.PENDING,
            approvedAt: null,
            approvedById: null,
          }),
        }),
      );
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
          data: expect.objectContaining({ amount: 800, expectedAmount: 800, version: { increment: 1 } }),
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
            expectedAmount: 300,
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
          data: expect.objectContaining({ amount: 400, expectedAmount: 400, status: VanCashHandoverStatus.PENDING, dailySheetId: SHEET_ID }),
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
        expectedAmount: 100,
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
            amount: 500,
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
        expect.objectContaining({
          data: expect.objectContaining({ approvedAmount: 450, amount: 450, adjustmentReason: 'recount' }),
        }),
      );
      expect(result.approvedAmount).toBe(450);
    });

    it('throws ConflictException on stale version (CAS mismatch)', async () => {
      const { svc } = makeService({ handover: { ...baseHandover, version: 5 } });
      await expect(svc.approveHandover(adminUser, HANDOVER_ID, { version: 1 })).rejects.toThrow(ConflictException);
    });
  });

  // ─── R5: final approved amount + Σ expectedAmount reconciliation ───────────

  describe('R5 — final approved amount (no adjustment rows)', () => {
    it('approve with an adjustment writes the FINAL amount into `amount`, keeps expectedAmount, and audits before/after amount', async () => {
      const { svc, tx, audit } = makeService({ handover: { ...baseHandover, version: 1 } });

      const result = await svc.approveHandover(adminUser, HANDOVER_ID, {
        version: 1,
        approvedAmount: 450,
        adjustmentReason: 'recount',
      });

      const data = tx.vanCashHandover.updateMany.mock.calls[0][0].data;
      expect(data.amount).toBe(450);
      expect(data.approvedAmount).toBe(450);
      // The sheet figure is NEVER touched by an approver.
      expect(data).not.toHaveProperty('expectedAmount');
      expect(result.amount).toBe(450);
      expect((result as any).expectedAmount).toBe(500);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'APPROVED',
          entity: 'VanCashHandover',
          changes: {
            // P4: the audit trail always records the handover's date + relatesToDate.
            before: { status: VanCashHandoverStatus.PENDING, amount: 500, date: '2026-09-01T00:00:00.000Z', relatesToDate: null },
            after: expect.objectContaining({ status: VanCashHandoverStatus.APPROVED, amount: 450, approvedAmount: 450 }),
          },
        }),
      );
    });

    it('createHandoverForClosedSheet seeds amount AND expectedAmount from the sheet cash figure', async () => {
      const { svc, tx } = makeService({ sheet: buildClosedSheet({ cashExpected: 640 }) });
      await svc.createHandoverForClosedSheet(tx as any, VENDOR_ID, SHEET_ID);
      const data = tx.vanCashHandover.create.mock.calls[0][0].data;
      expect(data.amount).toBe(640);
      expect(data.expectedAmount).toBe(640);
    });
  });

  describe('I6/I7 — handlePostCloseCorrection reconciles against Σ expectedAmount', () => {
    const approved = (over: Record<string, unknown> = {}) => ({
      ...baseHandover,
      status: VanCashHandoverStatus.APPROVED,
      approvedAt: new Date(),
      ...over,
    });

    it('I6: Σ expectedAmount tracks the sheet cashExpected across successive corrections', async () => {
      const original = approved();
      // 500 -> 800: delta 300 (expected chain = 500)
      const first = makeService({ chain: [original] });
      await first.svc.handlePostCloseCorrection(first.tx as any, VENDOR_ID, SHEET_ID, 800);
      const c1 = first.tx.vanCashHandover.create.mock.calls[0][0].data;
      expect(c1.expectedAmount).toBe(300);
      expect(original.expectedAmount + c1.expectedAmount).toBe(800);

      // 800 -> 650: delta -150 (expected chain = 500 + 300)
      const correction1 = approved({ id: 'c1', amount: 300, expectedAmount: 300, correctsEntryId: HANDOVER_ID });
      const second = makeService({ chain: [original, correction1] });
      await second.svc.handlePostCloseCorrection(second.tx as any, VENDOR_ID, SHEET_ID, 650);
      const c2 = second.tx.vanCashHandover.create.mock.calls[0][0].data;
      expect(c2.expectedAmount).toBe(-150);
      expect(original.expectedAmount + correction1.expectedAmount + c2.expectedAmount).toBe(650);
    });

    it('I7: approve-with-adjustment then a post-close correction preserves the approver variance and applies the delta to both fields', async () => {
      const { svc } = makeService({ handover: { ...baseHandover, version: 1 } });
      const adjusted = await svc.approveHandover(adminUser, HANDOVER_ID, {
        version: 1,
        approvedAmount: 450, // approver counted 50 short of the sheet's 500
        adjustmentReason: 'recount',
      });
      expect(adjusted.amount).toBe(450);

      const post = makeService({ chain: [adjusted as any] });
      await post.svc.handlePostCloseCorrection(post.tx as any, VENDOR_ID, SHEET_ID, 800);

      // delta is vs Σ expectedAmount (500), NOT Σ amount (450 -> would be 350).
      const data = post.tx.vanCashHandover.create.mock.calls[0][0].data;
      expect(data.amount).toBe(300);
      expect(data.expectedAmount).toBe(300);
      expect(data.status).toBe(VanCashHandoverStatus.APPROVED);

      const chainAmount = 450 + data.amount;
      const chainExpected = 500 + data.expectedAmount;
      expect(chainExpected).toBe(800); // tracks the sheet
      expect(chainAmount - chainExpected).toBe(-50); // variance survives
    });

    it('a PENDING single-row chain is rewritten in place — BOTH amount and expectedAmount', async () => {
      const { svc, tx, audit } = makeService({
        handover: { ...baseHandover },
        chain: [baseHandover],
      });
      await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 900);
      expect(tx.vanCashHandover.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 900, expectedAmount: 900 }) }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            before: { amount: 500, expectedAmount: 500 },
            after: expect.objectContaining({ amount: 900, expectedAmount: 900 }),
          },
        }),
      );
    });

    it('VOIDED chain rows do not count toward Σ expectedAmount', async () => {
      const original = approved();
      const voided = approved({
        id: 'c-void',
        amount: 100,
        expectedAmount: 100,
        correctsEntryId: HANDOVER_ID,
        status: VanCashHandoverStatus.VOIDED,
      });
      const { svc, tx } = makeService({ chain: [original, voided] });
      // Σ non-voided expected = 500 -> delta 200. (Counting the voided row would give 100.)
      await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 700);
      const data = tx.vanCashHandover.create.mock.calls[0][0].data;
      expect(data.expectedAmount).toBe(200);
      expect(data.amount).toBe(200);
    });

    it('is a no-op when Σ expectedAmount already equals the sheet figure, even if an approver adjusted `amount`', async () => {
      const adjusted = approved({ amount: 450, expectedAmount: 500 });
      const { svc, tx } = makeService({ chain: [adjusted] });
      const result = await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 500);
      expect(result).toBeNull();
      expect(tx.vanCashHandover.create).not.toHaveBeenCalled();
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
        staffLedgerEntry: {
          aggregate: jest.fn().mockResolvedValue(AGG0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        settlement: {
          aggregate: jest.fn().mockResolvedValue(AGG0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        crewCashDistribution: {
          aggregate: jest.fn().mockResolvedValue(AGG0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        officeCashRemittance: {
          aggregate: jest.fn().mockResolvedValue(AGG0),
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        fuelCardTopUp: {
          aggregate: jest.fn().mockResolvedValue(AGG0),
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        standaloneCrewCashExpense: {
          aggregate: jest.fn().mockResolvedValue(AGG0),
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        van: { findUnique: jest.fn().mockResolvedValue(null) },
        ...overrides,
      };
      const audit = { log: jest.fn().mockResolvedValue(undefined) };
      const permissions = { can: jest.fn().mockResolvedValue(true) };
      const svc = new VanCashLedgerService(prisma, audit as any, permissions as any, { assertWritable: jest.fn().mockResolvedValue(undefined) } as any, { getClosedLabels: jest.fn().mockResolvedValue(new Set()), closedLabelsAmong: jest.fn().mockResolvedValue([]), isDateClosed: jest.fn().mockResolvedValue(false) } as any);
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
        createdAt: new Date('2026-09-10T06:00:00Z'),
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

  // ─── Cash Ledger P2 — manual cash-in edit / void, period guard call sites ───

  describe('P2 period-guard call sites (remittances)', () => {
    it('createRemittance asks the guard about dto.date before creating', async () => {
      const { svc, prisma, periodGuard } = makeRemittanceService({ available: 100000 });
      await svc.createRemittance(accountantUser, {
        amount: 100,
        date: '2026-09-10',
        destination: OfficeCashRemittanceDestination.BANK,
      });
      expect(periodGuard.assertWritable).toHaveBeenCalledWith(VENDOR_ID, ['2026-09-10'], expect.anything());
      expect(periodGuard.assertWritable.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.officeCashRemittance.create.mock.invocationCallOrder[0],
      );
    });

    it('approveRemittance asks the guard about row.date; a guard rejection blocks the write', async () => {
      const { svc, tx, periodGuard } = makeRemittanceService({
        remittance: { ...baseRemittance, version: 1 },
        available: 100000,
      });
      await svc.approveRemittance(managerUser, REMITTANCE_ID, { version: 1 });
      expect(periodGuard.assertWritable).toHaveBeenCalledWith(VENDOR_ID, [baseRemittance.date], expect.anything());

      const blocked = makeRemittanceService({ remittance: { ...baseRemittance, version: 1 }, available: 100000 });
      blocked.periodGuard.assertWritable.mockRejectedValue(new ForbiddenException('period closed'));
      await expect(blocked.svc.approveRemittance(managerUser, REMITTANCE_ID, { version: 1 })).rejects.toThrow(
        'period closed',
      );
      expect(blocked.tx.officeCashRemittance.updateMany).not.toHaveBeenCalled();
      expect(tx.officeCashRemittance.updateMany).toHaveBeenCalled();
    });

    it('voidRemittance and correctRemittance ask the guard about the row date', async () => {
      const voided = makeRemittanceService({ remittance: { ...baseRemittance, version: 1 } });
      await voided.svc.voidRemittance(accountantUser, REMITTANCE_ID, { version: 1, voidReason: 'entered by mistake' });
      expect(voided.periodGuard.assertWritable).toHaveBeenCalledWith(VENDOR_ID, [baseRemittance.date], expect.anything());

      const root = { ...baseRemittance, version: 2, status: OfficeCashRemittanceStatus.PENDING };
      const corrected = makeRemittanceService({ chain: [root] });
      await corrected.svc.correctRemittance(accountantUser, REMITTANCE_ID, {
        version: 2,
        newAmount: 6500,
        correctionReason: 'typo in the amount',
      });
      expect(corrected.periodGuard.assertWritable).toHaveBeenCalledWith(
        VENDOR_ID,
        [baseRemittance.date, baseRemittance.date],
        expect.anything(),
      );
    });
  });

  describe('P2 manual cash-in — add / edit / void', () => {
    const MANUAL_ID = 'manual-001';
    const baseManual = {
      id: MANUAL_ID,
      vendorId: VENDOR_ID,
      vanId: null as string | null,
      openingBalance: 10000,
      openingDate: new Date('2026-09-05T00:00:00Z'),
      note: 'Owner top-up' as string | null,
      source: null as string | null,
      relatedVehicleId: null as string | null,
      relatedEmployeeId: null as string | null,
      setById: 'admin-001',
      status: ManualCashInStatus.ACTIVE as ManualCashInStatus,
      version: 1,
      editCount: 0,
      lastEditedAt: null as Date | null,
      updatedById: null as string | null,
      voidedById: null as string | null,
      voidedAt: null as Date | null,
      voidReason: null as string | null,
      createdAt: new Date('2026-09-05T06:00:00Z'),
      updatedAt: new Date('2026-09-05T06:00:00Z'),
    };
    type ManualRow = typeof baseManual;

    function makeManualService(opts: {
      row?: ManualRow | null;
      vans?: Array<{ id: string; vendorId: string }>;
      vehicles?: Array<{ id: string; vendorId: string }>;
      employees?: Array<{ id: string; vendorId: string; role: string }>;
    } = {}) {
      const {
        row = { ...baseManual },
        vans = [{ id: 'van-001', vendorId: VENDOR_ID }],
        vehicles = [{ id: 'vehicle-001', vendorId: VENDOR_ID }],
        employees = [{ id: 'driver-001', vendorId: VENDOR_ID, role: 'DRIVER' }],
      } = opts;
      let current: ManualRow | null = row ? { ...row } : null;

      const vanCashOpeningBalance = {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
          current && where.id === current.id && where.vendorId === current.vendorId ? { ...current } : null,
        ),
        // Applies `data` exactly like Prisma would for the increments the service uses.
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          if (
            !current ||
            where.id !== current.id ||
            where.vendorId !== current.vendorId ||
            where.version !== current.version ||
            (where.status !== undefined && where.status !== current.status)
          ) {
            return { count: 0 };
          }
          const next: any = { ...current };
          for (const [k, v] of Object.entries<any>(data)) {
            next[k] = v && typeof v === 'object' && 'increment' in v ? (current as any)[k] + v.increment : v;
          }
          current = next;
          return { count: 1 };
        }),
        findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...current })),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'manual-new',
          version: 1,
          status: ManualCashInStatus.ACTIVE,
          ...data,
        })),
      };
      const van = {
        findFirst: jest
          .fn()
          .mockImplementation(async ({ where }: any) =>
            vans.find((v) => v.id === where.id && v.vendorId === where.vendorId) ?? null,
          ),
      };
      const vehicle = {
        findFirst: jest
          .fn()
          .mockImplementation(async ({ where }: any) =>
            vehicles.find((v) => v.id === where.id && v.vendorId === where.vendorId) ?? null,
          ),
      };
      const user = {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
          employees.find(
            (e) =>
              e.id === where.id &&
              e.vendorId === where.vendorId &&
              (!where.role?.in || where.role.in.includes(e.role)),
          ) ?? null,
        ),
      };
      const prisma = { vanCashOpeningBalance, van, vehicle, user };
      const audit = { log: jest.fn().mockResolvedValue(undefined) };
      const permissions = { can: jest.fn().mockResolvedValue(true) };
      const periodGuard = { assertWritable: jest.fn().mockResolvedValue(undefined) };
      const svc = new VanCashLedgerService(prisma as any, audit as any, permissions as any, periodGuard as any, { getClosedLabels: jest.fn().mockResolvedValue(new Set()), closedLabelsAmong: jest.fn().mockResolvedValue([]), isDateClosed: jest.fn().mockResolvedValue(false) } as any);
      return { svc, prisma, audit, periodGuard };
    }

    const tomorrow = () => vendorDateString(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));

    describe('addManualCashIn()', () => {
      it('persists the optional source, audits it, and asks the guard about the date first', async () => {
        const { svc, prisma, audit, periodGuard } = makeManualService();
        await svc.addManualCashIn(adminUser, {
          openingBalance: 500,
          openingDate: '2026-09-01',
          note: 'Owner cash',
          source: ManualCashInSource.OWNER_INJECTION,
        });
        expect(periodGuard.assertWritable).toHaveBeenCalledWith(
          VENDOR_ID,
          [new Date('2026-09-01')],
          expect.anything(),
        );
        expect(prisma.vanCashOpeningBalance.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ source: 'OWNER_INJECTION', vendorId: VENDOR_ID, setById: adminUser.userId }),
        });
        expect(audit.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'CREATED',
            entity: 'VanCashOpeningBalance',
            changes: { after: expect.objectContaining({ source: 'OWNER_INJECTION', openingBalance: 500 }) },
          }),
        );
      });

      it('rejects a future date and writes nothing', async () => {
        const { svc, prisma, periodGuard } = makeManualService();
        await expect(
          svc.addManualCashIn(adminUser, { openingBalance: 500, openingDate: tomorrow() }),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.vanCashOpeningBalance.create).not.toHaveBeenCalled();
        expect(periodGuard.assertWritable).not.toHaveBeenCalled();
      });

      it('VEHICLE_RENTED_OUT: requires relatedVehicleId, rejects a co-supplied relatedEmployeeId, and persists the resolved vehicle', async () => {
        const { svc, prisma } = makeManualService();

        await expect(
          svc.addManualCashIn(adminUser, {
            openingBalance: 3000,
            openingDate: '2026-09-01',
            note: 'Rented the pickup to City Water for 2 days',
            source: ManualCashInSource.VEHICLE_RENTED_OUT,
          }),
        ).rejects.toThrow(BadRequestException);

        await expect(
          svc.addManualCashIn(adminUser, {
            openingBalance: 3000,
            openingDate: '2026-09-01',
            note: 'Rented the pickup to City Water for 2 days',
            source: ManualCashInSource.VEHICLE_RENTED_OUT,
            relatedVehicleId: 'vehicle-001',
            relatedEmployeeId: 'driver-001',
          }),
        ).rejects.toThrow(BadRequestException);

        await svc.addManualCashIn(adminUser, {
          openingBalance: 3000,
          openingDate: '2026-09-01',
          note: 'Rented the pickup to City Water for 2 days',
          source: ManualCashInSource.VEHICLE_RENTED_OUT,
          relatedVehicleId: 'vehicle-001',
        });
        expect(prisma.vanCashOpeningBalance.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            source: 'VEHICLE_RENTED_OUT',
            relatedVehicleId: 'vehicle-001',
            relatedEmployeeId: null,
          }),
        });
      });

      it('LABOUR_LENT_OUT: requires a relatedEmployeeId who is a Driver/Salesman/Loader of this vendor', async () => {
        const { svc, prisma } = makeManualService({
          employees: [
            { id: 'driver-001', vendorId: VENDOR_ID, role: 'DRIVER' },
            { id: 'accountant-001', vendorId: VENDOR_ID, role: 'ACCOUNTANT' },
          ],
        });

        await expect(
          svc.addManualCashIn(adminUser, {
            openingBalance: 1500,
            openingDate: '2026-09-01',
            note: 'Lent our loader to a neighbouring plant for the day',
            source: ManualCashInSource.LABOUR_LENT_OUT,
          }),
        ).rejects.toThrow(BadRequestException);

        // Not a Driver/Salesman/Loader -> rejected even though the user exists.
        await expect(
          svc.addManualCashIn(adminUser, {
            openingBalance: 1500,
            openingDate: '2026-09-01',
            note: 'Lent our loader to a neighbouring plant for the day',
            source: ManualCashInSource.LABOUR_LENT_OUT,
            relatedEmployeeId: 'accountant-001',
          }),
        ).rejects.toThrow(NotFoundException);

        await svc.addManualCashIn(adminUser, {
          openingBalance: 1500,
          openingDate: '2026-09-01',
          note: 'Lent our loader to a neighbouring plant for the day',
          source: ManualCashInSource.LABOUR_LENT_OUT,
          relatedEmployeeId: 'driver-001',
        });
        expect(prisma.vanCashOpeningBalance.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            source: 'LABOUR_LENT_OUT',
            relatedVehicleId: null,
            relatedEmployeeId: 'driver-001',
          }),
        });
      });

      it('rejects relatedVehicleId / relatedEmployeeId when the source is neither VEHICLE_RENTED_OUT nor LABOUR_LENT_OUT', async () => {
        const { svc } = makeManualService();
        await expect(
          svc.addManualCashIn(adminUser, {
            openingBalance: 500,
            openingDate: '2026-09-01',
            note: 'Owner cash',
            source: ManualCashInSource.OWNER_INJECTION,
            relatedVehicleId: 'vehicle-001',
          }),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('editManualCashIn()', () => {
      it('happy path: CAS on {id, vendorId, version, ACTIVE}, bumps version/editCount, audits ONLY the changed fields + reason', async () => {
        const { svc, prisma, audit, periodGuard } = makeManualService();

        const result = await svc.editManualCashIn(adminUser, MANUAL_ID, {
          version: 1,
          amount: 12000,
          reason: '  Typo in the amount  ',
        });

        expect(prisma.vanCashOpeningBalance.updateMany).toHaveBeenCalledTimes(1);
        const call = prisma.vanCashOpeningBalance.updateMany.mock.calls[0][0];
        expect(call.where).toEqual({
          id: MANUAL_ID,
          vendorId: VENDOR_ID,
          version: 1,
          status: ManualCashInStatus.ACTIVE,
        });
        expect(call.data).toEqual({
          openingBalance: 12000,
          version: { increment: 1 },
          editCount: { increment: 1 },
          lastEditedAt: expect.any(Date),
          updatedById: adminUser.userId,
        });
        expect(audit.log).toHaveBeenCalledWith({
          vendorId: VENDOR_ID,
          userId: adminUser.userId,
          userName: adminUser.name,
          action: 'UPDATED',
          entity: 'VanCashOpeningBalance',
          entityId: MANUAL_ID,
          changes: { before: { openingBalance: 10000 }, after: { openingBalance: 12000 }, reason: 'Typo in the amount' },
        });
        // The guard saw the (unchanged) old + new date before the write.
        expect(periodGuard.assertWritable).toHaveBeenCalledWith(
          VENDOR_ID,
          [baseManual.openingDate, baseManual.openingDate],
          expect.anything(),
        );
        expect(periodGuard.assertWritable.mock.invocationCallOrder[0]).toBeLessThan(
          prisma.vanCashOpeningBalance.updateMany.mock.invocationCallOrder[0],
        );
        expect(result).toMatchObject({ openingBalance: 12000, version: 2, editCount: 1, updatedById: adminUser.userId });
      });

      it('moving the date across days calls the guard with BOTH the old and the new date, and audits both', async () => {
        const { svc, prisma, audit, periodGuard } = makeManualService();

        await svc.editManualCashIn(adminUser, MANUAL_ID, { version: 1, date: '2026-08-31', reason: 'Wrong day' });

        expect(periodGuard.assertWritable).toHaveBeenCalledWith(
          VENDOR_ID,
          [baseManual.openingDate, new Date('2026-08-31')],
          expect.anything(),
        );
        const data = prisma.vanCashOpeningBalance.updateMany.mock.calls[0][0].data;
        expect(data.openingDate).toEqual(new Date('2026-08-31'));
        expect(audit.log.mock.calls[0][0].changes).toEqual({
          before: { openingDate: '2026-09-05T00:00:00.000Z' },
          after: { openingDate: '2026-08-31T00:00:00.000Z' },
          reason: 'Wrong day',
        });
      });

      it('a guard rejection (closed period) blocks the write and the audit', async () => {
        const { svc, prisma, audit, periodGuard } = makeManualService();
        periodGuard.assertWritable.mockRejectedValue(new ForbiddenException('period closed'));
        await expect(
          svc.editManualCashIn(adminUser, MANUAL_ID, { version: 1, amount: 1, reason: 'Fixing this entry' }),
        ).rejects.toThrow('period closed');
        expect(prisma.vanCashOpeningBalance.updateMany).not.toHaveBeenCalled();
        expect(audit.log).not.toHaveBeenCalled();
      });

      it('edits van / note / source: detach to office-wide (null), clear the source, set a new note', async () => {
        const { svc, prisma, audit } = makeManualService({
          row: { ...baseManual, vanId: 'van-001', source: 'REFUND' },
        });
        await svc.editManualCashIn(adminUser, MANUAL_ID, {
          version: 1,
          vanId: null,
          source: null,
          note: '  New note  ',
          reason: 'Re-classified entry',
        });
        const data = prisma.vanCashOpeningBalance.updateMany.mock.calls[0][0].data;
        expect(data).toMatchObject({ vanId: null, source: null, note: 'New note' });
        // Detaching needs no van lookup.
        expect(prisma.van.findFirst).not.toHaveBeenCalled();
        expect(audit.log.mock.calls[0][0].changes).toEqual({
          before: { vanId: 'van-001', note: 'Owner top-up', source: 'REFUND' },
          after: { vanId: null, note: 'New note', source: null },
          reason: 'Re-classified entry',
        });
      });

      it('no-change edit -> 400 (nothing written, nothing audited, guard untouched)', async () => {
        const { svc, prisma, audit, periodGuard } = makeManualService();
        const same = [
          { version: 1, amount: 10000, reason: 'Same amount again' },
          // same PKT calendar day expressed as a full timestamp
          { version: 1, date: '2026-09-05T03:00:00.000Z', reason: 'Same day again' },
          { version: 1, note: '  Owner top-up ', vanId: null, source: null, reason: 'Same everything' },
        ];
        for (const dto of same) {
          await expect(svc.editManualCashIn(adminUser, MANUAL_ID, dto)).rejects.toThrow(BadRequestException);
        }
        expect(prisma.vanCashOpeningBalance.updateMany).not.toHaveBeenCalled();
        expect(audit.log).not.toHaveBeenCalled();
        expect(periodGuard.assertWritable).not.toHaveBeenCalled();
      });

      it('stale version -> 409 (before any write); a lost CAS race -> 409 with no audit', async () => {
        const stale = makeManualService({ row: { ...baseManual, version: 3 } });
        await expect(
          stale.svc.editManualCashIn(adminUser, MANUAL_ID, { version: 1, amount: 1, reason: 'Trying to edit' }),
        ).rejects.toThrow(ConflictException);
        expect(stale.prisma.vanCashOpeningBalance.updateMany).not.toHaveBeenCalled();

        const raced = makeManualService();
        raced.prisma.vanCashOpeningBalance.updateMany.mockResolvedValueOnce({ count: 0 });
        await expect(
          raced.svc.editManualCashIn(adminUser, MANUAL_ID, { version: 1, amount: 1, reason: 'Trying to edit' }),
        ).rejects.toThrow(ConflictException);
        expect(raced.audit.log).not.toHaveBeenCalled();
      });

      it('voided entries cannot be edited -> 400', async () => {
        const { svc, prisma } = makeManualService({ row: { ...baseManual, status: ManualCashInStatus.VOIDED } });
        await expect(
          svc.editManualCashIn(adminUser, MANUAL_ID, { version: 1, amount: 1, reason: 'Trying to edit' }),
        ).rejects.toThrow("Voided entries can't be edited.");
        expect(prisma.vanCashOpeningBalance.updateMany).not.toHaveBeenCalled();
      });

      it('a future date -> 400', async () => {
        const { svc, prisma } = makeManualService();
        await expect(
          svc.editManualCashIn(adminUser, MANUAL_ID, { version: 1, date: tomorrow(), reason: 'Trying to edit' }),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.vanCashOpeningBalance.updateMany).not.toHaveBeenCalled();
      });

      it("another vendor's van -> 404; another vendor's entry / unknown id -> 404", async () => {
        const { svc, prisma, periodGuard } = makeManualService({ vans: [{ id: 'van-foreign', vendorId: 'vendor-999' }] });
        await expect(
          svc.editManualCashIn(adminUser, MANUAL_ID, { version: 1, vanId: 'van-foreign', reason: 'Trying to edit' }),
        ).rejects.toThrow(NotFoundException);
        expect(prisma.van.findFirst).toHaveBeenCalledWith({ where: { id: 'van-foreign', vendorId: VENDOR_ID } });
        expect(prisma.vanCashOpeningBalance.updateMany).not.toHaveBeenCalled();
        expect(periodGuard.assertWritable).not.toHaveBeenCalled();

        const foreign = makeManualService({ row: { ...baseManual, vendorId: 'vendor-999' } });
        await expect(
          foreign.svc.editManualCashIn(adminUser, MANUAL_ID, { version: 1, amount: 1, reason: 'Trying to edit' }),
        ).rejects.toThrow(NotFoundException);
        const missing = makeManualService({ row: null });
        await expect(
          missing.svc.editManualCashIn(adminUser, 'nope', { version: 1, amount: 1, reason: 'Trying to edit' }),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('voidManualCashIn()', () => {
      it('flips status to VOIDED (never a delete), stamps voidedBy/At/Reason, bumps version, audits VOIDED', async () => {
        const { svc, prisma, audit, periodGuard } = makeManualService();
        const result = await svc.voidManualCashIn(adminUser, MANUAL_ID, { version: 1, reason: ' Entered twice ' });

        const call = prisma.vanCashOpeningBalance.updateMany.mock.calls[0][0];
        expect(call.where).toEqual({ id: MANUAL_ID, vendorId: VENDOR_ID, version: 1, status: ManualCashInStatus.ACTIVE });
        expect(call.data).toEqual({
          status: ManualCashInStatus.VOIDED,
          voidedById: adminUser.userId,
          voidedAt: expect.any(Date),
          voidReason: 'Entered twice',
          version: { increment: 1 },
        });
        expect(periodGuard.assertWritable).toHaveBeenCalledWith(VENDOR_ID, [baseManual.openingDate], expect.anything());
        expect(audit.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'VOIDED',
            entity: 'VanCashOpeningBalance',
            entityId: MANUAL_ID,
            changes: {
              before: { status: 'ACTIVE' },
              after: { status: 'VOIDED', voidReason: 'Entered twice' },
              reason: 'Entered twice',
            },
          }),
        );
        expect(result).toMatchObject({ status: ManualCashInStatus.VOIDED, version: 2 });
      });

      it('already voided -> 400; stale version -> 409; lost race -> 409; unknown -> 404', async () => {
        const voided = makeManualService({ row: { ...baseManual, status: ManualCashInStatus.VOIDED } });
        await expect(
          voided.svc.voidManualCashIn(adminUser, MANUAL_ID, { version: 1, reason: 'Entered twice' }),
        ).rejects.toThrow(BadRequestException);

        const stale = makeManualService({ row: { ...baseManual, version: 4 } });
        await expect(
          stale.svc.voidManualCashIn(adminUser, MANUAL_ID, { version: 1, reason: 'Entered twice' }),
        ).rejects.toThrow(ConflictException);

        const raced = makeManualService();
        raced.prisma.vanCashOpeningBalance.updateMany.mockResolvedValueOnce({ count: 0 });
        await expect(
          raced.svc.voidManualCashIn(adminUser, MANUAL_ID, { version: 1, reason: 'Entered twice' }),
        ).rejects.toThrow(ConflictException);
        expect(raced.audit.log).not.toHaveBeenCalled();

        const missing = makeManualService({ row: null });
        await expect(
          missing.svc.voidManualCashIn(adminUser, 'nope', { version: 1, reason: 'Entered twice' }),
        ).rejects.toThrow(NotFoundException);
      });

      it('a guard rejection blocks the void', async () => {
        const { svc, prisma, periodGuard } = makeManualService();
        periodGuard.assertWritable.mockRejectedValue(new ForbiddenException('period closed'));
        await expect(
          svc.voidManualCashIn(adminUser, MANUAL_ID, { version: 1, reason: 'Entered twice' }),
        ).rejects.toThrow('period closed');
        expect(prisma.vanCashOpeningBalance.updateMany).not.toHaveBeenCalled();
      });
    });
  });

  describe('P2 DTO validation (reason is mandatory)', () => {
    const errorsFor = async (cls: any, plain: Record<string, unknown>) =>
      (await validate(plainToInstance(cls, plain))).map((e) => e.property).sort();

    it('EditManualCashInDto: missing / too-short / whitespace-only reason is rejected; a valid edit passes', async () => {
      expect(await errorsFor(EditManualCashInDto, { version: 1, amount: 5 })).toEqual(['reason']);
      expect(await errorsFor(EditManualCashInDto, { version: 1, amount: 5, reason: 'abcd' })).toEqual(['reason']);
      expect(await errorsFor(EditManualCashInDto, { version: 1, amount: 5, reason: '      ' })).toEqual(['reason']);
      expect(await errorsFor(EditManualCashInDto, { version: 1, amount: 5, reason: 'x'.repeat(501) })).toEqual(['reason']);
      expect(await errorsFor(EditManualCashInDto, { version: 1, amount: 5, reason: 'abcde' })).toEqual([]);
      // trimmed BEFORE length validation: 5 real chars padded with spaces is still valid...
      expect(await errorsFor(EditManualCashInDto, { version: 1, amount: 5, reason: '  abcde  ' })).toEqual([]);
      // ...but 4 real chars padded to 8 is not.
      expect(await errorsFor(EditManualCashInDto, { version: 1, amount: 5, reason: '  abcd  ' })).toEqual(['reason']);
    });

    it('EditManualCashInDto: version required; amount >= 0; date is a date string; vanId uuid or null; source enum or null', async () => {
      expect(await errorsFor(EditManualCashInDto, { reason: 'valid reason' })).toEqual(['version']);
      expect(await errorsFor(EditManualCashInDto, { version: 1, amount: -1, reason: 'valid reason' })).toEqual(['amount']);
      expect(await errorsFor(EditManualCashInDto, { version: 1, amount: 0, reason: 'valid reason' })).toEqual([]);
      expect(await errorsFor(EditManualCashInDto, { version: 1, date: 'not-a-date', reason: 'valid reason' })).toEqual(['date']);
      expect(await errorsFor(EditManualCashInDto, { version: 1, date: '2026-09-01', reason: 'valid reason' })).toEqual([]);
      expect(await errorsFor(EditManualCashInDto, { version: 1, vanId: 'nope', reason: 'valid reason' })).toEqual(['vanId']);
      expect(await errorsFor(EditManualCashInDto, { version: 1, vanId: null, reason: 'valid reason' })).toEqual([]);
      expect(await errorsFor(EditManualCashInDto, { version: 1, source: 'BOGUS', reason: 'valid reason' })).toEqual(['source']);
      expect(await errorsFor(EditManualCashInDto, { version: 1, source: null, reason: 'valid reason' })).toEqual([]);
    });

    it('VoidManualCashInDto: reason (>= 5 after trim) and version are mandatory', async () => {
      expect(await errorsFor(VoidManualCashInDto, { version: 1 })).toEqual(['reason']);
      expect(await errorsFor(VoidManualCashInDto, { version: 1, reason: 'abcd' })).toEqual(['reason']);
      expect(await errorsFor(VoidManualCashInDto, { reason: 'abcde' })).toEqual(['version']);
      expect(await errorsFor(VoidManualCashInDto, { version: 1, reason: 'abcde' })).toEqual([]);
    });

    it('AddCashInDto: source is optional but must be a valid enum value', async () => {
      const base = { openingBalance: 1, openingDate: '2026-09-01' };
      expect(await errorsFor(AddCashInDto, base)).toEqual([]);
      expect(await errorsFor(AddCashInDto, { ...base, source: 'REFUND' })).toEqual([]);
      expect(await errorsFor(AddCashInDto, { ...base, source: 'BOGUS' })).toEqual(['source']);
    });
  });


  // ─── P4 — redirect rule (spec R7) ─────────────────────────────────────────

  describe('P4 redirect rule — handlePostCloseCorrection()', () => {
    const approved = (over: Record<string, unknown> = {}) => ({
      ...baseHandover,
      status: VanCashHandoverStatus.APPROVED,
      approvedAt: new Date(),
      ...over,
    });

    it('closed period: the correction is dated TODAY (PKT, UTC-midnight) and relatesToDate keeps the sheet business date; amounts unchanged', async () => {
      const { svc, tx, audit, periodStore } = makeService({ chain: [approved()] }, ['2026-09']);

      await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 800);

      const data = tx.vanCashHandover.create.mock.calls[0][0].data;
      expect(data.date).toEqual(redirectDateForToday());
      expect(data.date.toISOString()).toMatch(/T00:00:00\.000Z$/);
      expect(data.relatesToDate).toEqual(new Date('2026-09-01'));
      // I6/I7 semantics untouched: delta vs Σ expectedAmount, auto-approved, chained.
      expect(data).toMatchObject({
        amount: 300,
        expectedAmount: 300,
        status: VanCashHandoverStatus.APPROVED,
        correctsEntryId: HANDOVER_ID,
        dailySheetId: SHEET_ID,
      });
      expect(500 + data.expectedAmount).toBe(800);
      expect(periodStore.isDateClosed).toHaveBeenCalledWith(VENDOR_ID, baseHandover.date);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            before: { currentTotal: 500 },
            after: expect.objectContaining({
              newCashAmount: 800,
              delta: 300,
              redirectedFrom: '2026-09-01T00:00:00.000Z',
              date: redirectDateForToday().toISOString(),
              relatesToDate: '2026-09-01T00:00:00.000Z',
            }),
          },
        }),
      );
    });

    it('open period: exactly as before — dated the chain date, no relatesToDate, no redirect audit keys', async () => {
      const { svc, tx, audit } = makeService({ chain: [approved()] }, ['2026-08']);

      await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 800);

      const data = tx.vanCashHandover.create.mock.calls[0][0].data;
      expect(data.date).toEqual(baseHandover.date);
      expect('relatesToDate' in data).toBe(false);
      const after = audit.log.mock.calls[0][0].changes.after;
      expect(after).toEqual({ newCashAmount: 800, delta: 300, correctsEntryId: HANDOVER_ID });
    });

    it('a chain whose ROOT was already redirected keeps the ROOT business date when redirected again', async () => {
      // Root handover: business day 5 Aug, approved into 3 Sep (redirected). Now 3 Sep is closed too.
      const root = approved({ date: new Date('2026-09-03'), relatesToDate: new Date('2026-08-05') });
      const { svc, tx } = makeService({ chain: [root] }, ['2026-08', '2026-09']);

      await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 700);

      const data = tx.vanCashHandover.create.mock.calls[0][0].data;
      expect(data.date).toEqual(redirectDateForToday());
      expect(data.relatesToDate).toEqual(new Date('2026-08-05')); // ROOT's business date, not 3 Sep
      expect(data.amount).toBe(200);
    });

    it('the redirect is decided on the MOST RECENT chain row (a later, open month is not redirected)', async () => {
      const original = approved({ date: new Date('2026-08-05') });
      const correction = approved({
        id: 'c-1',
        date: new Date('2026-09-03'),
        relatesToDate: new Date('2026-08-05'),
        amount: 100,
        expectedAmount: 100,
        correctsEntryId: HANDOVER_ID,
      });
      // Aug is closed but the most recent posting (3 Sep) sits in an OPEN month.
      const { svc, tx } = makeService({ chain: [original, correction] }, ['2026-08']);

      await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 650);

      const data = tx.vanCashHandover.create.mock.calls[0][0].data;
      expect(data.date).toEqual(new Date('2026-09-03'));
      expect('relatesToDate' in data).toBe(false);
      expect(data).toMatchObject({ amount: 50, correctsEntryId: 'c-1' });
    });

    it('a PENDING single-row chain is rewritten in place and NEVER redirected (approval redirects instead)', async () => {
      const { svc, tx, periodStore } = makeService({ handover: { ...baseHandover }, chain: [baseHandover] }, ['2026-09']);

      await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 900);

      const data = tx.vanCashHandover.update.mock.calls[0][0].data;
      expect(data).toEqual({ amount: 900, expectedAmount: 900, version: { increment: 1 } });
      expect(periodStore.isDateClosed).not.toHaveBeenCalled();
    });

    it('the seed row (no handover yet) keeps the sheet date even in a closed period', async () => {
      const { svc, tx } = makeService({ chain: [], sheet: buildClosedSheet() }, ['2026-09']);

      await svc.handlePostCloseCorrection(tx as any, VENDOR_ID, SHEET_ID, 400);

      const data = tx.vanCashHandover.create.mock.calls[0][0].data;
      expect(data.date).toEqual(new Date('2026-09-01'));
      expect('relatesToDate' in data).toBe(false);
      expect(data.status).toBe(VanCashHandoverStatus.PENDING);
    });

    it('I6: Σ expectedAmount still tracks the sheet across successive redirected corrections', async () => {
      const original = approved();
      const first = makeService({ chain: [original] }, ['2026-09']);
      await first.svc.handlePostCloseCorrection(first.tx as any, VENDOR_ID, SHEET_ID, 800);
      const c1 = first.tx.vanCashHandover.create.mock.calls[0][0].data;
      expect(original.expectedAmount + c1.expectedAmount).toBe(800);

      // The redirected correction lives in the current month; now that month is closed too.
      const correction1 = approved({
        id: 'c1',
        date: c1.date,
        relatesToDate: c1.relatesToDate,
        amount: c1.amount,
        expectedAmount: c1.expectedAmount,
        correctsEntryId: HANDOVER_ID,
      });
      const second = makeService({ chain: [original, correction1] }, ['2026-09', periodLabelOf(redirectDateForToday())]);
      await second.svc.handlePostCloseCorrection(second.tx as any, VENDOR_ID, SHEET_ID, 650);
      const c2 = second.tx.vanCashHandover.create.mock.calls[0][0].data;
      expect(c2.expectedAmount).toBe(-150);
      expect(original.expectedAmount + correction1.expectedAmount + c2.expectedAmount).toBe(650);
      expect(c2.relatesToDate).toEqual(new Date('2026-09-01')); // still the ROOT business date
    });
  });

  describe('P4 redirect rule — approveHandover()', () => {
    it('closed period: date -> today and relatesToDate -> original date are written in the SAME CAS updateMany; audit shows both', async () => {
      const { svc, tx, audit } = makeService({ handover: { ...baseHandover, version: 1 } }, ['2026-09']);

      const result = await svc.approveHandover(adminUser, HANDOVER_ID, { version: 1 });

      expect(tx.vanCashHandover.updateMany).toHaveBeenCalledTimes(1);
      const call = tx.vanCashHandover.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: HANDOVER_ID, vendorId: VENDOR_ID, version: 1 });
      expect(call.data.date).toEqual(redirectDateForToday());
      expect(call.data.relatesToDate).toEqual(new Date('2026-09-01'));
      expect(call.data).toMatchObject({ status: VanCashHandoverStatus.APPROVED, amount: 500, approvedAmount: 500 });
      expect(result.date).toEqual(redirectDateForToday());
      expect(result.relatesToDate).toEqual(new Date('2026-09-01'));

      const changes = audit.log.mock.calls[0][0].changes;
      expect(changes.before).toMatchObject({ date: '2026-09-01T00:00:00.000Z', relatesToDate: null });
      expect(changes.after).toMatchObject({
        date: redirectDateForToday().toISOString(),
        relatesToDate: '2026-09-01T00:00:00.000Z',
      });
    });

    it('approval needs no override permission (system-of-record action) — permissions are never consulted for the redirect', async () => {
      const { svc, permissions } = makeService({ handover: { ...baseHandover, version: 1 } }, ['2026-09']);
      await svc.approveHandover(adminUser, HANDOVER_ID, { version: 1 });
      expect(permissions.can).not.toHaveBeenCalled();
    });

    it('open period: NO date / relatesToDate in the CAS data; audit shows the unchanged date', async () => {
      const { svc, tx, audit } = makeService({ handover: { ...baseHandover, version: 1 } }, ['2026-08']);

      await svc.approveHandover(adminUser, HANDOVER_ID, { version: 1 });

      const data = tx.vanCashHandover.updateMany.mock.calls[0][0].data;
      expect('date' in data).toBe(false);
      expect('relatesToDate' in data).toBe(false);
      const changes = audit.log.mock.calls[0][0].changes;
      expect(changes.before.date).toBe('2026-09-01T00:00:00.000Z');
      expect(changes.after.date).toBe('2026-09-01T00:00:00.000Z');
      expect(changes.after.relatesToDate).toBeNull();
    });

    it('a handover already carrying relatesToDate (redirected at correction time) keeps that ORIGINAL date when redirected again', async () => {
      const { svc, tx } = makeService(
        { handover: { ...baseHandover, date: new Date('2026-09-03'), relatesToDate: new Date('2026-08-05'), version: 1 } as any },
        ['2026-09'],
      );

      await svc.approveHandover(adminUser, HANDOVER_ID, { version: 1 });

      const data = tx.vanCashHandover.updateMany.mock.calls[0][0].data;
      expect(data.relatesToDate).toEqual(new Date('2026-08-05'));
      expect(data.date).toEqual(redirectDateForToday());
    });

    it('a stale version still conflicts and a redirect never bypasses the CAS', async () => {
      const { svc } = makeService({ handover: { ...baseHandover, version: 5 } }, ['2026-09']);
      await expect(svc.approveHandover(adminUser, HANDOVER_ID, { version: 1 })).rejects.toThrow(ConflictException);
    });

    it('I7: the approver adjustment still lands in `amount` when the approval is redirected', async () => {
      const { svc, tx } = makeService({ handover: { ...baseHandover, version: 1 } }, ['2026-09']);
      const adjusted = await svc.approveHandover(adminUser, HANDOVER_ID, {
        version: 1,
        approvedAmount: 450,
        adjustmentReason: 'recount',
      });
      const data = tx.vanCashHandover.updateMany.mock.calls[0][0].data;
      expect(data).toMatchObject({ amount: 450, approvedAmount: 450, adjustmentReason: 'recount' });
      expect(adjusted.amount).toBe(450);
      expect(adjusted.expectedAmount).toBe(500); // sheet figure untouched -> variance -50
    });
  });
});
