import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { VanCashLedgerService } from './van-cash-ledger.service';
import { DailySheetKind, DiscrepancyCaseStatus, DiscrepancyType, VanCashHandoverStatus } from '@prisma/client';
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
  const svc = new VanCashLedgerService(prisma as any, audit as any);
  return { svc, prisma, tx, audit };
}

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
});
