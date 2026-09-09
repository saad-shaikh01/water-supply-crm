import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  DailySheetKind,
  DiscrepancyCaseStatus,
  DiscrepancyType,
  LedgerEntryStatus,
  Prisma,
  StaffLedgerCategory,
  VanCashHandover,
  VanCashHandoverStatus,
} from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { paginate, type PaginatedResult } from '../../common/helpers/paginate';
import { AuditService } from '../audit/audit.service';
import { resolveSheetCash, SHEET_CASH_RELOAD_INCLUDE } from '../daily-sheet/sheet-cash.util';
import {
  normalizeCrewCashRow,
  normalizeExpenseRow,
  normalizeStaffLedgerRow,
  shortSheetId,
  type ExpenseCenterRow,
} from '../expense-center/expense-center-domain.util';
import { SetOpeningBalanceDto } from './dto/set-opening-balance.dto';
import { ApproveHandoverDto } from './dto/approve-handover.dto';
import { VanCashLedgerStatsQueryDto, VanCashLedgerTimelineQueryDto } from './dto/van-cash-ledger-query.dto';

function versionMismatch(expected: number, received: number): ConflictException {
  return new ConflictException(`Version mismatch: expected ${expected}, received ${received}. Reload and retry.`);
}

/** Money is reported to 2dp — float sums otherwise leak 0.30000000000000004-style noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function buildDateFilter(from?: Date, to?: Date): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const filter: { gte?: Date; lte?: Date } = {};
  if (from) filter.gte = from;
  if (to) filter.lte = to;
  return filter;
}

export type VanCashLedgerRowType = 'OPENING_BALANCE' | 'CASH_IN' | 'CASH_IN_CORRECTION' | 'CASH_OUT';

export interface VanCashLedgerRow {
  /** `${type}:${originalId}` — stable and unique across the merged sources. */
  id: string;
  date: string;
  type: VanCashLedgerRowType;
  /**
   * SIGNED contribution to the running balance — positive for cash in
   * (OPENING_BALANCE / CASH_IN), negative for cash out. A CASH_IN_CORRECTION
   * carries the row's own DELTA verbatim, which may itself be negative (a
   * downward adjustment reduces the balance even though its `type` is still
   * "cash in family", not "cash out") — `displayAmount` is always the
   * magnitude for UI, `amount` is what the running-balance fold actually uses.
   */
  amount: number;
  displayAmount: number;
  /** Filled in by the running-balance fold in getTimeline — 0 until then. */
  runningBalance: number;
  description: string;
  vanPlateNumber: string | null;
  sourceType: string;
  sourceRecordId: string;
}

export interface VanCashLedgerStats {
  totalExpense: number;
  totalCashIn: number;
  availableBalance: number;
  pendingHandoverCount: number;
}

/**
 * Van Cash Ledger — the "cash in" counterpart to the Expense Center
 * (docs reference: CrewCashDistributionService is the architectural template —
 * source record -> pending -> approve -> posted, self-relation for post-close
 * corrections, check-then-create idempotency, per-action audit trail via the
 * generic AuditService rather than a dedicated audit table).
 *
 * `createHandoverForClosedSheet` / `handlePostCloseCorrection` are the two
 * write hooks other modules call INTO this service from inside their own
 * `$transaction` — see the call sites in DailySheetService (closeSheet /
 * approveClose, right alongside CrewCashDistributionService.syncSheetToLedger)
 * and ExpenseService (correctClosed / voidClosed / createClosed, right
 * alongside the postCloseExpenseCorrectionCount bump).
 */
@Injectable()
export class VanCashLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Opening balance ───────────────────────────────────────────────────────

  async setOpeningBalance(user: AuthUser, dto: SetOpeningBalanceDto) {
    const van = await this.prisma.van.findFirst({ where: { id: dto.vanId, vendorId: user.vendorId } });
    if (!van) throw new NotFoundException('Van not found.');

    const before = await this.prisma.vanCashOpeningBalance.findUnique({ where: { vanId: dto.vanId } });

    const upserted = await this.prisma.vanCashOpeningBalance.upsert({
      where: { vanId: dto.vanId },
      create: {
        vendorId: user.vendorId,
        vanId: dto.vanId,
        openingBalance: dto.openingBalance,
        openingDate: new Date(dto.openingDate),
        setById: user.userId,
      },
      update: {
        openingBalance: dto.openingBalance,
        openingDate: new Date(dto.openingDate),
        setById: user.userId,
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: before ? 'UPDATED' : 'CREATED',
      entity: 'VanCashOpeningBalance',
      entityId: upserted.id,
      changes: {
        before: before ? { openingBalance: before.openingBalance, openingDate: before.openingDate } : undefined,
        after: { openingBalance: upserted.openingBalance, openingDate: upserted.openingDate },
      },
    });

    return upserted;
  }

  // ── Hook #1: sheet close ─────────────────────────────────────────────────

  /**
   * Called FROM inside DailySheetService's close transaction (closeSheet /
   * approveClose), in the exact same place `CrewCashDistributionService.
   * syncSheetToLedger` is called — a sheet can never end up closed with its
   * cash handover only partially created.
   *
   * Reads the sheet's final reconciled cash figure via `resolveSheetCash`
   * (which itself delegates to `buildReconciliation` for a freshly-closed,
   * unmodified sheet — see sheet-cash.util.ts). Skips creating anything when
   * that figure is 0 (no meaningful cash event — e.g. an all-monthly route
   * with nothing collected). WALK_IN sheets post their handover already
   * APPROVED (no office review needed for a synthetic self-pickup sheet with
   * no real driver custody handoff); every other sheet starts PENDING.
   */
  async createHandoverForClosedSheet(
    tx: Prisma.TransactionClient,
    vendorId: string,
    sheetId: string,
  ): Promise<VanCashHandover | null> {
    const sheet = await tx.dailySheet.findUnique({
      where: { id: sheetId },
      include: SHEET_CASH_RELOAD_INCLUDE,
    });
    if (!sheet) return null;

    const resolved = resolveSheetCash(sheet as unknown as Record<string, unknown>);
    if (resolved.cashExpected === 0) return null;

    // Check-then-create idempotency guard, same discipline
    // CrewCashDistributionService's own duplicate-guard comment documents —
    // only the ORIGINAL (non-correction) handover is guarded; a correction
    // row legitimately shares its parent's dailySheetId.
    const existing = await tx.vanCashHandover.findFirst({
      where: { dailySheetId: sheetId, correctsEntryId: null },
    });
    if (existing) return existing;

    const sheetRow = sheet as unknown as {
      vanId: string;
      driverId: string;
      date: Date;
      kind: DailySheetKind;
    };
    const isWalkIn = sheetRow.kind === DailySheetKind.WALK_IN;

    return tx.vanCashHandover.create({
      data: {
        vendorId,
        vanId: sheetRow.vanId,
        dailySheetId: sheetId,
        amount: resolved.cashExpected,
        submittedById: sheetRow.driverId,
        date: sheetRow.date,
        status: isWalkIn ? VanCashHandoverStatus.APPROVED : VanCashHandoverStatus.PENDING,
        approvedAt: isWalkIn ? new Date() : null,
        approvedById: null,
      },
    });
  }

  // ── Hook #2: post-close correction ──────────────────────────────────────

  /**
   * Called from wherever the post-close expense/cash correction flow
   * recomputes a closed sheet's cash figure — today that is
   * `ExpenseService.correctClosed` / `voidClosed` / `createClosed`, right
   * alongside their own `postCloseExpenseCorrectionCount` bump, inside the
   * SAME transaction.
   *
   * Sums the sheet's existing handover chain (original + any prior
   * corrections) to get the currently-recorded total, and reconciles it
   * against `newCashAmount` (the caller's freshly recomputed
   * `resolveSheetCash(...).cashExpected`):
   *   - delta === 0                              → no-op.
   *   - no handover exists yet (delta seed)       → the original close-time
   *     amount was 0 (skipped by createHandoverForClosedSheet) but the
   *     correction makes it non-zero; seed a fresh row rather than silently
   *     dropping the cash event.
   *   - original still PENDING (nothing approved) → rewrite its `amount` in
   *     place — there is nothing downstream to keep honest yet.
   *   - original APPROVED (or a correction chain already exists) → append a
   *     new correction row carrying the DELTA, auto-approved (a
   *     system-generated correction of an already-accepted fact, not a fresh
   *     request), dated the sheet's own date.
   */
  async handlePostCloseCorrection(
    tx: Prisma.TransactionClient,
    vendorId: string,
    sheetId: string,
    newCashAmount: number,
  ): Promise<VanCashHandover | null> {
    const chain = await tx.vanCashHandover.findMany({
      where: { vendorId, dailySheetId: sheetId },
      orderBy: { createdAt: 'asc' },
    });

    if (chain.length === 0) {
      if (newCashAmount === 0) return null;

      const sheet = await tx.dailySheet.findUnique({
        where: { id: sheetId },
        select: { vanId: true, driverId: true, date: true, kind: true },
      });
      if (!sheet) throw new NotFoundException('Daily sheet not found.');
      const isWalkIn = sheet.kind === DailySheetKind.WALK_IN;

      const seeded = await tx.vanCashHandover.create({
        data: {
          vendorId,
          vanId: sheet.vanId,
          dailySheetId: sheetId,
          amount: newCashAmount,
          submittedById: sheet.driverId,
          date: sheet.date,
          status: isWalkIn ? VanCashHandoverStatus.APPROVED : VanCashHandoverStatus.PENDING,
          approvedAt: isWalkIn ? new Date() : null,
          approvedById: null,
        },
      });

      await this.audit.log({
        vendorId,
        action: 'CORRECTED',
        entity: 'VanCashHandover',
        entityId: seeded.id,
        changes: { after: { seeded: true, amount: newCashAmount, dailySheetId: sheetId } },
      });

      return seeded;
    }

    const currentTotal = round2(chain.reduce((sum, row) => sum + row.amount, 0));
    const delta = round2(newCashAmount - currentTotal);
    if (delta === 0) return null;

    const original = chain.find((row) => row.correctsEntryId === null) ?? chain[0];
    const mostRecent = chain[chain.length - 1];

    if (original.status === VanCashHandoverStatus.PENDING && chain.length === 1) {
      const updated = await tx.vanCashHandover.update({
        where: { id: original.id },
        data: { amount: newCashAmount, version: { increment: 1 } },
      });

      await this.audit.log({
        vendorId,
        action: 'CORRECTED',
        entity: 'VanCashHandover',
        entityId: original.id,
        changes: { before: { amount: original.amount }, after: { amount: updated.amount } },
      });

      return updated;
    }

    const correction = await tx.vanCashHandover.create({
      data: {
        vendorId,
        vanId: mostRecent.vanId,
        dailySheetId: sheetId,
        amount: delta,
        submittedById: mostRecent.submittedById,
        date: mostRecent.date,
        // Auto-approved — a system-generated correction of an already-accepted
        // fact, not a fresh request that needs office review.
        status: VanCashHandoverStatus.APPROVED,
        approvedAt: new Date(),
        approvedById: null,
        correctsEntryId: mostRecent.id,
      },
    });

    await this.audit.log({
      vendorId,
      action: 'CORRECTED',
      entity: 'VanCashHandover',
      entityId: correction.id,
      changes: {
        before: { currentTotal },
        after: { newCashAmount, delta, correctsEntryId: mostRecent.id },
      },
    });

    return correction;
  }

  // ── Approval ─────────────────────────────────────────────────────────────

  async approveHandover(user: AuthUser, id: string, dto: ApproveHandoverDto) {
    const { updated, previousStatus } = await this.prisma.$transaction(async (tx) => {
      const handover = await tx.vanCashHandover.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!handover) throw new NotFoundException('Van cash handover not found.');
      if (handover.status !== VanCashHandoverStatus.PENDING) {
        throw new BadRequestException('Only a PENDING handover can be approved.');
      }

      const unresolvedDiscrepancy = await tx.sheetDiscrepancyCase.findFirst({
        where: {
          vendorId: user.vendorId,
          dailySheetId: handover.dailySheetId,
          type: DiscrepancyType.CASH,
          status: DiscrepancyCaseStatus.REPORTED,
        },
        select: { id: true },
      });
      if (unresolvedDiscrepancy) {
        throw new BadRequestException("Resolve the sheet's cash discrepancy before approving this handover.");
      }

      const approvedAmount = dto.approvedAmount ?? handover.amount;
      const approvedAmountChanged = approvedAmount !== handover.amount;
      if (approvedAmountChanged && !dto.adjustmentReason) {
        throw new BadRequestException(
          'adjustmentReason is required when approvedAmount differs from the handover amount.',
        );
      }

      const claim = await tx.vanCashHandover.updateMany({
        where: { id, vendorId: user.vendorId, version: dto.version },
        data: {
          status: VanCashHandoverStatus.APPROVED,
          approvedById: user.userId,
          approvedAt: new Date(),
          approvedAmount,
          adjustmentReason: dto.adjustmentReason ?? null,
          version: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        throw versionMismatch(handover.version, dto.version);
      }

      return {
        updated: await tx.vanCashHandover.findUniqueOrThrow({ where: { id } }),
        previousStatus: handover.status,
      };
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'APPROVED',
      entity: 'VanCashHandover',
      entityId: id,
      changes: {
        before: { status: previousStatus },
        after: { status: updated.status, approvedAmount: updated.approvedAmount, adjustmentReason: updated.adjustmentReason },
      },
    });

    return updated;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async getPendingHandovers(vendorId: string, vanId?: string) {
    return this.prisma.vanCashHandover.findMany({
      where: { vendorId, status: VanCashHandoverStatus.PENDING, ...(vanId && { vanId }) },
      include: {
        van: { select: { id: true, plateNumber: true } },
        submittedBy: { select: { id: true, name: true } },
        dailySheet: { select: { id: true, date: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  async getStats(vendorId: string, query: VanCashLedgerStatsQueryDto): Promise<VanCashLedgerStats> {
    const { vanId } = query;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? endOfDay(new Date(query.to)) : undefined;
    const dateFilter = buildDateFilter(from, to);

    const [cashInAgg, totalExpense, pendingHandoverCount, availableBalance] = await Promise.all([
      this.prisma.vanCashHandover.aggregate({
        where: {
          vendorId,
          status: VanCashHandoverStatus.APPROVED,
          ...(vanId && { vanId }),
          ...(dateFilter && { date: dateFilter }),
        },
        _sum: { amount: true },
      }),
      this.collectCashOutTotal(vendorId, vanId, dateFilter),
      this.prisma.vanCashHandover.count({
        where: { vendorId, status: VanCashHandoverStatus.PENDING, ...(vanId && { vanId }) },
      }),
      this.computeAvailableBalance(vendorId, vanId),
    ]);

    return {
      totalCashIn: round2(cashInAgg._sum.amount ?? 0),
      totalExpense: round2(totalExpense),
      pendingHandoverCount,
      availableBalance: round2(availableBalance),
    };
  }

  /**
   * Merged, date-ascending, paginated cash timeline for a van (or the whole
   * vendor). Unlike `ExpenseCenterService.getTimeline`'s bounded-window
   * fetch-then-merge (there is no way to compute a correct RUNNING BALANCE
   * from a bounded window without also knowing everything that came before
   * it), this fetches every row matching the filter and folds the running
   * balance once over the full sorted set before paginating the tail — an
   * accepted trade-off given Van Cash Ledger's volume (at most one handover
   * per van per day, plus its related cash-out rows) is orders of magnitude
   * smaller than the general Expense Center dataset this pattern was
   * designed for.
   */
  async getTimeline(vendorId: string, query: VanCashLedgerTimelineQueryDto): Promise<PaginatedResult<VanCashLedgerRow>> {
    const { page = 1, limit = 20, vanId } = query;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? endOfDay(new Date(query.to)) : undefined;
    const dateFilter = buildDateFilter(from, to);

    const [openingRows, cashInRows, expenseRows, ledgerRows, crewCashRows] = await Promise.all([
      this.buildOpeningBalanceRows(vendorId, vanId, to),
      this.prisma.vanCashHandover.findMany({
        where: {
          vendorId,
          status: VanCashHandoverStatus.APPROVED,
          ...(vanId && { vanId }),
          ...(dateFilter && { date: dateFilter }),
        },
        include: { van: { select: { plateNumber: true } } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.expense.findMany({
        where: {
          vendorId,
          paidFromCash: true,
          ...(vanId && { vanId }),
          ...(dateFilter && { date: dateFilter }),
        },
        select: {
          id: true,
          category: true,
          amount: true,
          paidFromCash: true,
          description: true,
          date: true,
          dailySheetId: true,
          fuelLog: { select: { id: true } },
          vehicleServiceRecord: { select: { id: true } },
          van: { select: { plateNumber: true } },
          createdBy: { select: { name: true } },
          dailySheet: { select: { isClosed: true } },
        },
        orderBy: { date: 'asc' },
      }),
      // StaffLedgerEntry has no van relation — same documented Expense Center
      // assumption applies here (a van-scoped view cannot attribute it).
      vanId
        ? Promise.resolve([])
        : this.prisma.staffLedgerEntry.findMany({
            where: {
              vendorId,
              category: { not: StaffLedgerCategory.CREW_CASH },
              status: { not: LedgerEntryStatus.VOIDED },
              ...(dateFilter && { effectiveDate: dateFilter }),
            },
            select: {
              id: true,
              category: true,
              amount: true,
              description: true,
              effectiveDate: true,
              user: { select: { name: true } },
              createdBy: { select: { name: true } },
              payrollEntryId: true,
            },
            orderBy: { effectiveDate: 'asc' },
          }),
      this.prisma.crewCashDistribution.findMany({
        where: {
          vendorId,
          ...(vanId && { dailySheet: { vanId } }),
          ...(dateFilter && { date: dateFilter }),
        },
        select: {
          id: true,
          category: true,
          amount: true,
          notes: true,
          date: true,
          dailySheetId: true,
          employee: { select: { name: true } },
          distributedBy: { select: { name: true } },
          dailySheet: { select: { van: { select: { plateNumber: true } } } },
          syncedAt: true,
        },
        orderBy: { date: 'asc' },
      }),
    ]);

    const merged: VanCashLedgerRow[] = [...openingRows];
    for (const row of cashInRows) merged.push(this.normalizeCashIn(row));
    for (const row of expenseRows) merged.push(this.normalizeCashOut(normalizeExpenseRow(row)));
    for (const row of ledgerRows) merged.push(this.normalizeCashOut(normalizeStaffLedgerRow(row)));
    for (const row of crewCashRows) merged.push(this.normalizeCashOut(normalizeCrewCashRow(row)));

    merged.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

    let running = 0;
    for (const row of merged) {
      running = round2(running + row.amount);
      row.runningBalance = running;
    }

    const total = merged.length;
    const skip = (page - 1) * limit;
    return paginate(merged.slice(skip, skip + limit), total, page, limit);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Cash-out total across the three cash-only Expense Center sources: `Expense`
   * rows with `paidFromCash: true` (a card-paid expense never touches physical
   * cash), plus StaffLedgerEntry and CrewCashDistribution rows in full — those
   * two have no `paidFromCash` concept and are treated as always-cash, matching
   * the Expense Center's own documented assumption (see
   * expense-center.service.ts's `collectPeriodTotals` doc comment).
   */
  private async collectCashOutTotal(
    vendorId: string,
    vanId: string | undefined,
    dateFilter?: { gte?: Date; lte?: Date },
  ): Promise<number> {
    const [expenseAgg, ledgerRows, crewCashAgg] = await Promise.all([
      this.prisma.expense.aggregate({
        where: {
          vendorId,
          paidFromCash: true,
          ...(vanId && { vanId }),
          ...(dateFilter && { date: dateFilter }),
        },
        _sum: { amount: true },
      }),
      // StaffLedgerEntry has no van relation — excluded from a van-scoped total.
      vanId
        ? Promise.resolve([] as { amount: number }[])
        : this.prisma.staffLedgerEntry.findMany({
            where: {
              vendorId,
              category: { not: StaffLedgerCategory.CREW_CASH },
              status: { not: LedgerEntryStatus.VOIDED },
              ...(dateFilter && { effectiveDate: dateFilter }),
            },
            select: { amount: true },
          }),
      this.prisma.crewCashDistribution.aggregate({
        where: {
          vendorId,
          ...(vanId && { dailySheet: { vanId } }),
          ...(dateFilter && { date: dateFilter }),
        },
        _sum: { amount: true },
      }),
    ]);

    const ledgerTotal = ledgerRows.reduce((sum, row) => sum + Math.abs(row.amount), 0);
    return (expenseAgg._sum.amount ?? 0) + ledgerTotal + (crewCashAgg._sum.amount ?? 0);
  }

  /**
   * The true current balance — opening balance + all approved cash-in to date
   * minus all cash-out to date, ignoring any `from`/`to` filter (only
   * `vanId`, when given, narrows it).
   */
  private async computeAvailableBalance(vendorId: string, vanId?: string): Promise<number> {
    const [openingTotal, cashInAgg, cashOutTotal] = await Promise.all([
      vanId
        ? this.prisma.vanCashOpeningBalance
            .findFirst({ where: { vendorId, vanId } })
            .then((row) => row?.openingBalance ?? 0)
        : this.prisma.vanCashOpeningBalance
            .aggregate({ where: { vendorId }, _sum: { openingBalance: true } })
            .then((agg) => agg._sum.openingBalance ?? 0),
      this.prisma.vanCashHandover.aggregate({
        where: { vendorId, status: VanCashHandoverStatus.APPROVED, ...(vanId && { vanId }) },
        _sum: { amount: true },
      }),
      this.collectCashOutTotal(vendorId, vanId, undefined),
    ]);

    return openingTotal + (cashInAgg._sum.amount ?? 0) - cashOutTotal;
  }

  /**
   * Opening-balance synthetic row(s) for the timeline (see class-level query
   * doc for the full contract). Per-van: the van's own opening balance row,
   * included when its `openingDate` falls at-or-before the visible range's
   * end. Company-wide (no van filter): ALL vans' opening balances summed into
   * ONE synthetic row labeled "Opening Balance (all vans)", included whenever
   * at least one van's `openingDate` is at-or-before the range end — dated at
   * the earliest contributing van's `openingDate` so it sorts first.
   */
  private async buildOpeningBalanceRows(
    vendorId: string,
    vanId: string | undefined,
    to: Date | undefined,
  ): Promise<VanCashLedgerRow[]> {
    if (vanId) {
      const row = await this.prisma.vanCashOpeningBalance.findFirst({ where: { vendorId, vanId } });
      if (!row) return [];
      if (to && row.openingDate > to) return [];
      return [
        {
          id: `OPENING_BALANCE:${row.id}`,
          date: row.openingDate.toISOString(),
          type: 'OPENING_BALANCE',
          amount: row.openingBalance,
          displayAmount: Math.abs(row.openingBalance),
          runningBalance: 0,
          description: 'Opening Balance',
          vanPlateNumber: null,
          sourceType: 'OPENING_BALANCE',
          sourceRecordId: row.id,
        },
      ];
    }

    const rows = await this.prisma.vanCashOpeningBalance.findMany({ where: { vendorId } });
    const eligible = rows.filter((row) => !to || row.openingDate <= to);
    if (eligible.length === 0) return [];

    const total = round2(eligible.reduce((sum, row) => sum + row.openingBalance, 0));
    const earliestDate = eligible.reduce(
      (min, row) => (row.openingDate < min ? row.openingDate : min),
      eligible[0].openingDate,
    );

    return [
      {
        id: 'OPENING_BALANCE:ALL',
        date: earliestDate.toISOString(),
        type: 'OPENING_BALANCE',
        amount: total,
        displayAmount: Math.abs(total),
        runningBalance: 0,
        description: 'Opening Balance (all vans)',
        vanPlateNumber: null,
        sourceType: 'OPENING_BALANCE',
        sourceRecordId: 'ALL',
      },
    ];
  }

  private normalizeCashIn(row: VanCashHandover & { van: { plateNumber: string } }): VanCashLedgerRow {
    const isCorrection = row.correctsEntryId !== null;
    return {
      id: `${isCorrection ? 'CASH_IN_CORRECTION' : 'CASH_IN'}:${row.id}`,
      date: row.date.toISOString(),
      type: isCorrection ? 'CASH_IN_CORRECTION' : 'CASH_IN',
      // Signed — a downward correction can legitimately be negative even
      // though its type is still "cash in family" (see interface doc).
      amount: row.amount,
      displayAmount: Math.abs(row.amount),
      runningBalance: 0,
      description: isCorrection
        ? `Cash handover correction — Daily Sheet #${shortSheetId(row.dailySheetId)}`
        : `Cash handover — Daily Sheet #${shortSheetId(row.dailySheetId)}`,
      vanPlateNumber: row.van.plateNumber,
      sourceType: 'VAN_CASH_HANDOVER',
      sourceRecordId: row.id,
    };
  }

  private normalizeCashOut(row: ExpenseCenterRow): VanCashLedgerRow {
    return {
      id: `CASH_OUT:${row.id}`,
      date: row.date,
      type: 'CASH_OUT',
      amount: -row.amount,
      displayAmount: row.amount,
      runningBalance: 0,
      description: row.title,
      vanPlateNumber: row.vanPlateNumber,
      sourceType: row.sourceType,
      sourceRecordId: row.sourceRecordId,
    };
  }
}
