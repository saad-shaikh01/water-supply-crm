import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  CrewRole,
  DiscrepancyCaseStatus,
  DiscrepancyType,
  FuelCardTopUp,
  FuelCardTopUpStatus,
  LedgerEntryStatus,
  ManualCashInStatus,
  OfficeCashRemittance,
  OfficeCashRemittanceDestination,
  OfficeCashRemittanceStatus,
  Prisma,
  SettlementMethod,
  StaffLedgerCategory,
  StandaloneCrewCashExpense,
  StandaloneCrewCashStatus,
  VanCashHandover,
  VanCashHandoverStatus,
  VanCashOpeningBalance,
} from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import type { Permission } from '@water-supply-crm/authz';
import { isFutureVendorDate, vendorDateString, vendorDayEnd, vendorDayStart } from '../../common/helpers/date.util';
import { paginate, type PaginatedResult } from '../../common/helpers/paginate';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from '../authz/permission.service';
import { resolveSheetCash, SHEET_CASH_RELOAD_INCLUDE } from '../daily-sheet/sheet-cash.util';
import {
  normalizeExpenseRow,
  normalizeStaffLedgerRow,
  shortSheetId,
  type ExpenseCenterRow,
} from '../expense-center/expense-center-domain.util';
import {
  isStandaloneCrewCashTwinLocked,
  STANDALONE_CREW_CASH_LOCKED_REASON,
} from '../payroll/standalone-crew-cash-lock.util';
import { AddCashInDto } from './dto/add-cash-in.dto';
import { EditManualCashInDto } from './dto/edit-manual-cash-in.dto';
import { VoidManualCashInDto } from './dto/void-manual-cash-in.dto';
import { ApproveHandoverDto } from './dto/approve-handover.dto';
import { CreateRemittanceDto } from './dto/create-remittance.dto';
import { ApproveRemittanceDto } from './dto/approve-remittance.dto';
import { VoidRemittanceDto } from './dto/void-remittance.dto';
import { CorrectRemittanceDto } from './dto/correct-remittance.dto';
import { VanCashLedgerStatsQueryDto, VanCashLedgerTimelineQueryDto } from './dto/van-cash-ledger-query.dto';
import { classifyStaffLedgerEntry, isCashSettlement, type CashLedgerBucket } from './cash-ledger-buckets';
import {
  type CashLedgerDayStatement,
  type CashLedgerDirection,
  type CashLedgerHistoryEvent,
  type CashLedgerHistoryResponse,
  type CashLedgerRowV2,
  type CashLedgerSummary,
  type ManualCashInSource,
  type SheetCashBreakdown,
} from './cash-ledger-contract';
import { CashLedgerPeriodGuard } from './cash-ledger-period.guard';
import { CashLedgerPeriodStore } from './cash-ledger-period.store';
import { periodDisplayLabel, periodLabelOf, redirectDateForToday } from './cash-ledger-period.util';
import {
  buildHistoryEvent,
  buildRecordCreatedEvent,
  collectReferencedIds,
  manualCashInSourceLabel,
  sortHistoryEvents,
  type HistoryResolvers,
} from './cash-ledger-history';
import { buildDayStatements, computeLagDays } from './cash-ledger-day-statements';
import { compareLedgerRows, pktDay } from './cash-ledger-sort';
import { hasActiveFilters, matchesFilters, resolveTimelineFilters, summarizeFiltered } from './cash-ledger-filters';
import { mergePendingRows } from './cash-ledger-pending';
import type { CashLedgerFilteredMeta } from './cash-ledger-contract';
import { buildStatement, emptyBucketTotals, summarizeTotals, type BucketTotals } from './cash-ledger-statement';
import { buildDailySummary } from './cash-ledger-daily-summary';
import type { CashLedgerDailySummary } from './cash-ledger-contract';
import type { CashLedgerDailySummaryQueryDto } from './dto/cash-ledger-daily-summary-query.dto';

export type {
  CashLedgerDayStatement,
  CashLedgerDirection,
  CashLedgerHistoryAction,
  CashLedgerHistoryChange,
  CashLedgerHistoryChangeKind,
  CashLedgerHistoryEvent,
  CashLedgerHistoryResponse,
  CashLedgerRowV2,
  ManualCashInSource,
  CashLedgerStatementTotals,
  CashLedgerSummary,
  SheetCashBreakdown,
} from './cash-ledger-contract';

function versionMismatch(expected: number, received: number): ConflictException {
  return new ConflictException(`Version mismatch: expected ${expected}, received ${received}. Reload and retry.`);
}

/** Money is reported to 2dp — float sums otherwise leak 0.30000000000000004-style noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The PKT calendar day (YYYY-MM-DD) a bare date string or ISO timestamp refers to. */
function calendarDay(input: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : vendorDateString(new Date(input));
}

/** A record edited less than this long after creation is treated as "not edited" (create-flow follow-up writes). */
const EDIT_GRACE_MS = 60_000;

/**
 * Standalone-crew-cash rows whose payroll twin is rolled into a locked payroll
 * period. Kept off the wire type on purpose: whether that explains a missing
 * edit button depends on the CALLER's permission, resolved later in
 * `applyRowPermissions`.
 */
const TWIN_LOCKED_ROWS = new WeakSet<object>();

const DIRECTION_BY_BUCKET: Record<CashLedgerBucket, CashLedgerDirection> = {
  SHEET_CASH_IN: 'IN',
  OFFICE_CASH_IN: 'IN',
  OFFICE_EXPENSE: 'OUT',
  PAYROLL_CASH: 'OUT',
  CREW_CASH: 'OUT',
  OWNER_TRANSFER: 'TRANSFER',
  FUEL_CARD: 'TRANSFER',
};

/**
 * Builds the complete Row v2 block for a row. Every source calls this so no row
 * can miss a field: `direction` + `lagDays` are derived here, everything else
 * defaults to "not applicable" and is overridden per source.
 */
function rowV2(
  bucket: CashLedgerBucket,
  createdAt: Date,
  date: string,
  overrides: Partial<CashLedgerRowV2> = {},
): Required<CashLedgerRowV2> {
  return {
    direction: DIRECTION_BY_BUCKET[bucket],
    recordedByName: null,
    lagDays: computeLagDays(createdAt.toISOString(), date),
    isEdited: false,
    lastEditedAt: null,
    notes: null,
    reference: null,
    hasAttachment: false,
    employeeId: null,
    expectedAmount: null,
    variance: null,
    voidedAt: null,
    voidedByName: null,
    canVoid: false,
    canEdit: false,
    editBlockedReason: null,
    source: null,
    recordedById: null,
    approvedById: null,
    destination: null,
    periodClosed: false,
    // Stamped on the returned page by getTimeline (periodLabelOf(row.date)).
    periodLabel: '',
    canOverride: false,
    relatesToDate: null,
    ...overrides,
  };
}

/** "12 Aug" for the PKT day of a redirected posting's ORIGINAL business date (row title suffix). */
function shortDayLabel(date: Date): string {
  const [y, m, d] = vendorDateString(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** The permission that lets an admin write into a CLOSED accounting period (owned by the authz catalog). */
const OVERRIDE_LOCK_PERMISSION = 'van_cash_ledger:override_lock' as string as Permission;

/** A date window over a source's own date column. `lt` is used for the "everything before `from`" brought-forward read. */
type DateRange = { gte?: Date; lte?: Date; lt?: Date };

function buildDateFilter(from?: Date, to?: Date): DateRange | undefined {
  if (!from && !to) return undefined;
  const filter: DateRange = {};
  if (from) filter.gte = from;
  if (to) filter.lte = to;
  return filter;
}

/**
 * Resolves the `from`/`to` query strings into a PKT (Asia/Karachi) window —
 * `from` = PKT midnight of that day, `to` = the last millisecond of that PKT
 * day — independent of the server process timezone.
 */
function resolveWindow(query: { from?: string; to?: string }): { from?: Date; to?: Date; dateFilter?: DateRange } {
  const from = query.from ? vendorDayStart(query.from) : undefined;
  const to = query.to ? vendorDayEnd(query.to) : undefined;
  return { from, to, dateFilter: buildDateFilter(from, to) };
}

/**
 * The ONE definition of what each cash source contains — shared by the
 * timeline rows (findMany), the period aggregates, the brought-forward read and
 * the live available balance, so they can never disagree. Van-scoped callers
 * skip the vendor-wide sources entirely (remittances, fuel-card top-ups,
 * crew cash and payroll cash are not attributable to one van).
 */
const sourceWhere = {
  /** SHEET_CASH_IN — APPROVED handovers only (the final amount). */
  handover: (vendorId: string, vanId: string | undefined, range?: DateRange): Prisma.VanCashHandoverWhereInput => ({
    vendorId,
    status: VanCashHandoverStatus.APPROVED,
    ...(vanId && { vanId }),
    ...(range && { date: range }),
  }),
  /**
   * OFFICE_CASH_IN — manual entries, dated by openingDate (the same window as every other source).
   * Aggregates count ACTIVE only; the timeline also lists VOIDED rows (folded as 0).
   */
  manualCashIn: (
    vendorId: string,
    vanId: string | undefined,
    statuses: ManualCashInStatus[],
    range?: DateRange,
  ): Prisma.VanCashOpeningBalanceWhereInput => ({
    vendorId,
    status: { in: statuses },
    ...(vanId && { vanId }),
    ...(range && { openingDate: range }),
  }),
  /**
   * OFFICE_EXPENSE — direct cash expenses only. Sheet-linked ones are already
   * netted out of that sheet's handover (folding them again would double-count).
   */
  officeExpense: (vendorId: string, vanId: string | undefined, range?: DateRange): Prisma.ExpenseWhereInput => ({
    vendorId,
    paidFromCash: true,
    dailySheetId: null,
    ...(vanId && { vanId }),
    ...(range && { date: range }),
  }),
  /** PAYROLL_CASH (a) — R6: POSTED ADVANCE debits, by effectiveDate (see classifyStaffLedgerEntry). */
  payrollAdvance: (vendorId: string, range?: DateRange): Prisma.StaffLedgerEntryWhereInput => ({
    vendorId,
    category: StaffLedgerCategory.ADVANCE,
    status: LedgerEntryStatus.POSTED,
    amount: { lt: 0 },
    ...(range && { effectiveDate: range }),
  }),
  /** PAYROLL_CASH (b) — R6: CASH settlements, by paidAt. */
  cashSettlement: (vendorId: string, range?: DateRange): Prisma.SettlementWhereInput => ({
    vendorId,
    method: SettlementMethod.CASH,
    ...(range && { paidAt: range }),
  }),
  /** OWNER_TRANSFER — aggregates count APPROVED only; the timeline also lists VOIDED rows (folded as 0). */
  remittance: (
    vendorId: string,
    statuses: OfficeCashRemittanceStatus[],
    range?: DateRange,
  ): Prisma.OfficeCashRemittanceWhereInput => ({
    vendorId,
    status: { in: statuses },
    ...(range && { date: range }),
  }),
  /** FUEL_CARD — aggregates count ACTIVE only; the timeline also lists VOIDED rows (folded as 0). */
  fuelCardTopUp: (vendorId: string, statuses: FuelCardTopUpStatus[], range?: DateRange): Prisma.FuelCardTopUpWhereInput => ({
    vendorId,
    status: { in: statuses },
    ...(range && { date: range }),
  }),
  /** CREW_CASH — standalone (no Daily Sheet) crew cash. Sheet-synced crew cash already lives inside handovers. */
  standaloneCrewCash: (
    vendorId: string,
    statuses: StandaloneCrewCashStatus[],
    range?: DateRange,
  ): Prisma.StandaloneCrewCashExpenseWhereInput => ({
    vendorId,
    status: { in: statuses },
    ...(range && { date: range }),
  }),
};

export type VanCashLedgerRowType =
  | 'OPENING_BALANCE'
  | 'CASH_IN'
  | 'CASH_IN_CORRECTION'
  | 'CASH_OUT'
  | 'CASH_REMITTANCE_OUT'
  | 'FUEL_CARD_TOPUP_OUT'
  | 'STANDALONE_CREW_CASH_OUT'
  | 'PAYROLL_SETTLEMENT_OUT';

export interface VanCashLedgerRow extends Required<CashLedgerRowV2> {
  /** `${type}:${originalId}` — stable and unique across the merged sources. */
  id: string;
  date: string;
  /**
   * ISO timestamp the SOURCE record was created — the second key of the
   * deterministic ledger order (PKT day → createdAt → bucket rank → id).
   */
  createdAt: string;
  /** Which of the seven cash-ledger buckets this movement belongs to. */
  bucket: CashLedgerBucket;
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
  title: string;
  vanId: string | null;
  vanPlateNumber: string | null;
  sourceType: string;
  sourceRecordId: string;
  sourceBadge: string;
  /**
   * Only meaningful for CASH_IN / CASH_IN_CORRECTION — always 'APPROVED' in
   * practice here, since getTimeline only ever queries APPROVED handovers
   * (a PENDING one has no place in a settled running balance; it surfaces
   * instead via getPendingHandovers / the Pending Approvals panel). Carried
   * through anyway for type-consistency with that endpoint's rows and so a
   * future change to what getTimeline queries doesn't silently break the
   * frontend's status check.
   */
  status: VanCashHandoverStatus | null;
  dailySheetId: string | null;
  submittedByName: string | null;
  approvedByName: string | null;
  /** Optimistic-concurrency token for the approve action — null where not applicable (opening balance / cash-out rows are never approved from here). */
  version: number | null;
  /**
   * CASH_REMITTANCE_OUT / FUEL_CARD_TOPUP_OUT only — true when this row has
   * been VOIDED. A voided row is still shown in the timeline (struck-through,
   * with `voidReason`) for the audit trail, but contributes 0 to the running
   * balance. `false`/omitted for every other row type.
   */
  isVoided?: boolean;
  /** CASH_REMITTANCE_OUT / FUEL_CARD_TOPUP_OUT only — the mandatory reason captured when the row was voided. */
  voidReason?: string | null;
  /**
   * CASH_REMITTANCE_OUT only — true when this row is a DELTA correction row
   * (`correctsEntryId != null`), not the root of a logical remittance. The
   * frontend uses this to keep the "Correct" action off correction rows, where
   * a per-row amount would be mistaken for the chain total.
   */
  isCorrection?: boolean;
  /**
   * CASH_OUT only — carried straight through from the underlying
   * `ExpenseCenterRow` so the Cash Ledger timeline can reuse the Expense
   * Center's own detail-drawer / edit-routing component verbatim instead of
   * re-implementing it. `undefined` for every other row type.
   */
  domain?: string;
  category?: string;
  categoryLabel?: string;
  costSign?: string;
  paidFromCash?: boolean | null;
  employeeName?: string | null;
  /** `true` when this row can no longer be edited/deleted (see `lockedReason`). */
  locked?: boolean;
  lockedReason?: string | null;
}

export interface VanCashLedgerStats {
  /** Date-range scoped — office expenses + payroll cash + crew cash (transfers are NOT expenses). */
  totalExpense: number;
  /** Date-range scoped — sheet cash in + office (manual) cash in. */
  totalCashIn: number;
  /** LIVE, all-time — never date-scoped. */
  availableBalance: number;
  pendingHandoverCount: number;
  /** Date-range scoped — sum of APPROVED office->owner remittances in the window. */
  totalRemitted: number;
  /** NOT date-range scoped — count of PENDING office->owner remittances awaiting approval. */
  pendingRemittanceCount: number;
  /** Date-range scoped — sum of ACTIVE (non-voided) fuel card top-ups in the window. */
  totalFuelCardTopUps: number;
  /** Date-range scoped — sum of ACTIVE (non-voided) standalone (no Daily Sheet) crew cash in the window (== crewCash). */
  totalStandaloneCrewCash: number;
  /** Date-range scoped — APPROVED handovers (final amounts). */
  sheetCashIn: number;
  /** Date-range scoped — manual cash-in entries. */
  officeCashIn: number;
  /** Date-range scoped — direct (dailySheetId null) cash expenses. */
  officeExpenses: number;
  /** Date-range scoped — POSTED ADVANCE debits + CASH settlements (vendor-wide only). */
  payrollCash: number;
  /** Date-range scoped — ACTIVE standalone crew cash. */
  crewCash: number;
  /** Signed sum of everything dated before `from` (0 when no `from`). */
  broughtForward: number;
  /** broughtForward + totalCashIn − totalExpense − totalRemitted − totalFuelCardTopUps. */
  expectedClosing: number;
}

/** getTimeline's return: the standard paginated envelope plus the brought-forward balance in `meta`. */
export type VanCashLedgerTimelineResult = Omit<PaginatedResult<VanCashLedgerRow>, 'meta'> & {
  meta: PaginatedResult<VanCashLedgerRow>['meta'] & {
    broughtForward: number;
    /**
     * Per-day statement for every PKT day that appears on the returned page,
     * computed over the WHOLE window so a day split across pages is complete.
     */
    dayStatements: Record<string, CashLedgerDayStatement>;
    /** P3 — only when an entry filter is active: subtotal of the filtered rows (`total` is the filtered count too). */
    filtered?: CashLedgerFilteredMeta;
  };
};

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
    private readonly permissions: PermissionService,
    private readonly periodGuard: CashLedgerPeriodGuard,
    private readonly periodStore: CashLedgerPeriodStore,
  ) {}

  // ── Manual cash in ───────────────────────────────────────────────────────

  /**
   * Records a manual cash-in event that didn't come through a driver
   * handover — repeatable (any number of dated entries), and `vanId` is
   * optional (null = general/office-wide, only visible in the vendor-wide
   * timeline/balance). Covers both a one-time historical balance backfill and
   * any later off-cycle cash injection. No approval step: this is the office
   * directly recording its own action, not a driver's claim to be verified.
   */
  async addManualCashIn(user: AuthUser, dto: AddCashInDto) {
    // Cash cannot move in the future — a future-dated entry would inflate
    // today's balance with money that has not arrived yet.
    if (isFutureVendorDate(dto.openingDate)) {
      throw new BadRequestException('The cash-in date cannot be in the future.');
    }
    if (dto.vanId) {
      const van = await this.prisma.van.findFirst({ where: { id: dto.vanId, vendorId: user.vendorId } });
      if (!van) throw new NotFoundException('Van not found.');
    }

    const openingDate = new Date(dto.openingDate);
    await this.periodGuard.assertWritable(user.vendorId, [openingDate], { userId: user.userId });

    const created = await this.prisma.vanCashOpeningBalance.create({
      data: {
        vendorId: user.vendorId,
        vanId: dto.vanId ?? null,
        openingBalance: dto.openingBalance,
        openingDate,
        note: dto.note ?? null,
        source: dto.source ?? null,
        setById: user.userId,
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'VanCashOpeningBalance',
      entityId: created.id,
      changes: {
        after: {
          vanId: created.vanId,
          openingBalance: created.openingBalance,
          openingDate: created.openingDate,
          note: created.note,
          source: created.source ?? null,
        },
      },
    });

    return created;
  }

  /**
   * Edits an ACTIVE manual cash-in in place (P2). The normal way to correct an
   * entry — void is the secondary action. Rules:
   *   - only fields present in the DTO are considered; at least one must really
   *     differ from the stored row (else 400) — a no-op edit is never audited;
   *   - the new date must not be in the future;
   *   - a new `vanId` must belong to this vendor (`null` = office-wide);
   *   - the period guard is asked about BOTH the old and the new date — moving
   *     an entry across a period boundary writes into both periods;
   *   - optimistic concurrency: a compare-and-swap on `version` (and ACTIVE),
   *     a lost race is a 409;
   *   - the audit row carries ONLY the changed fields (before/after) + the reason.
   */
  async editManualCashIn(user: AuthUser, id: string, dto: EditManualCashInDto): Promise<VanCashOpeningBalance> {
    const row = await this.prisma.vanCashOpeningBalance.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!row) throw new NotFoundException('Manual cash-in not found.');
    if (row.status === ManualCashInStatus.VOIDED) {
      throw new BadRequestException("Voided entries can't be edited.");
    }

    const reason = dto.reason.trim();

    // ── which fields actually change ──
    const data: Prisma.VanCashOpeningBalanceUncheckedUpdateManyInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (dto.amount !== undefined && dto.amount !== row.openingBalance) {
      data.openingBalance = dto.amount;
      before.openingBalance = row.openingBalance;
      after.openingBalance = dto.amount;
    }

    let nextDate = row.openingDate;
    if (dto.date !== undefined) {
      if (isFutureVendorDate(dto.date)) {
        throw new BadRequestException('The cash-in date cannot be in the future.');
      }
      if (calendarDay(dto.date) !== vendorDateString(row.openingDate)) {
        nextDate = new Date(dto.date);
        data.openingDate = nextDate;
        before.openingDate = row.openingDate.toISOString();
        after.openingDate = nextDate.toISOString();
      }
    }

    if (dto.vanId !== undefined && dto.vanId !== row.vanId) {
      if (dto.vanId) {
        const van = await this.prisma.van.findFirst({ where: { id: dto.vanId, vendorId: user.vendorId } });
        if (!van) throw new NotFoundException('Van not found.');
      }
      data.vanId = dto.vanId;
      before.vanId = row.vanId;
      after.vanId = dto.vanId;
    }

    if (dto.note !== undefined) {
      const nextNote = dto.note.trim() || null;
      if (nextNote !== (row.note ?? null)) {
        data.note = nextNote;
        before.note = row.note ?? null;
        after.note = nextNote;
      }
    }

    if (dto.source !== undefined && dto.source !== (row.source ?? null)) {
      data.source = dto.source;
      before.source = row.source ?? null;
      after.source = dto.source;
    }

    if (Object.keys(after).length === 0) {
      throw new BadRequestException('Nothing to update — no field differs from the current entry.');
    }
    if (row.version !== dto.version) throw versionMismatch(row.version, dto.version);

    // Both the old and the new date: moving an entry across a period boundary is a write into both.
    await this.periodGuard.assertWritable(user.vendorId, [row.openingDate, nextDate], { userId: user.userId });

    const claim = await this.prisma.vanCashOpeningBalance.updateMany({
      where: { id, vendorId: user.vendorId, version: dto.version, status: ManualCashInStatus.ACTIVE },
      data: {
        ...data,
        version: { increment: 1 },
        editCount: { increment: 1 },
        lastEditedAt: new Date(),
        updatedById: user.userId,
      },
    });
    if (claim.count === 0) throw versionMismatch(row.version, dto.version);

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATED',
      entity: 'VanCashOpeningBalance',
      entityId: id,
      changes: { before, after, reason },
    });

    return this.prisma.vanCashOpeningBalance.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Voids an ACTIVE manual cash-in (status flip — never a DELETE). The
   * SECONDARY action; editing is the normal correction. A voided entry stays in
   * the timeline (struck through, amount 0) but drops out of every aggregate.
   */
  async voidManualCashIn(user: AuthUser, id: string, dto: VoidManualCashInDto): Promise<VanCashOpeningBalance> {
    const row = await this.prisma.vanCashOpeningBalance.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!row) throw new NotFoundException('Manual cash-in not found.');
    if (row.status === ManualCashInStatus.VOIDED) {
      throw new BadRequestException('This entry is already voided.');
    }
    if (row.version !== dto.version) throw versionMismatch(row.version, dto.version);

    const reason = dto.reason.trim();
    await this.periodGuard.assertWritable(user.vendorId, [row.openingDate], { userId: user.userId });

    const claim = await this.prisma.vanCashOpeningBalance.updateMany({
      where: { id, vendorId: user.vendorId, version: dto.version, status: ManualCashInStatus.ACTIVE },
      data: {
        status: ManualCashInStatus.VOIDED,
        voidedById: user.userId,
        voidedAt: new Date(),
        voidReason: reason,
        version: { increment: 1 },
      },
    });
    if (claim.count === 0) throw versionMismatch(row.version, dto.version);

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'VOIDED',
      entity: 'VanCashOpeningBalance',
      entityId: id,
      changes: {
        before: { status: ManualCashInStatus.ACTIVE },
        after: { status: ManualCashInStatus.VOIDED, voidReason: reason },
        reason,
      },
    });

    return this.prisma.vanCashOpeningBalance.findUniqueOrThrow({ where: { id } });
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
   * with nothing collected). Every sheet — ROUTE or WALK_IN alike — starts
   * PENDING: WALK_IN originally posted auto-APPROVED (no office review, a
   * synthetic self-pickup sheet has no real driver custody handoff), but the
   * client explicitly denied that on 2026-09-11 — a walk-in day's cash now
   * goes through the exact same Pending Approvals review as a route sheet's.
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
    };

    return tx.vanCashHandover.create({
      data: {
        vendorId,
        vanId: sheetRow.vanId,
        dailySheetId: sheetId,
        // `amount` is the LEDGER figure (the final approved amount once
        // APPROVED); `expectedAmount` is the SHEET figure and is never touched
        // by an approver — both start equal.
        amount: resolved.cashExpected,
        expectedAmount: resolved.cashExpected,
        submittedById: sheetRow.driverId,
        date: sheetRow.date,
        status: VanCashHandoverStatus.PENDING,
        approvedAt: null,
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
   * Sums the SHEET-side figure (`expectedAmount`) of the sheet's non-voided
   * handover chain (original + any prior corrections) and reconciles it
   * against `newCashAmount` (the caller's freshly recomputed
   * `resolveSheetCash(...).cashExpected`). Reconciling against Σ expectedAmount
   * — NOT Σ amount — means an approver's adjustment (amount − expectedAmount,
   * the "variance") is preserved across later post-close corrections: the
   * sheet delta is applied to both fields.
   *   - delta === 0                              → no-op.
   *   - no handover exists yet (delta seed)       → the original close-time
   *     amount was 0 (skipped by createHandoverForClosedSheet) but the
   *     correction makes it non-zero; seed a fresh row rather than silently
   *     dropping the cash event.
   *   - original still PENDING (nothing approved) → rewrite `amount` AND
   *     `expectedAmount` in place — there is nothing downstream to keep honest
   *     yet.
   *   - original APPROVED (or a correction chain already exists) → append a
   *     new correction row carrying the DELTA (amount = expectedAmount),
   *     auto-approved (a system-generated correction of an already-accepted
   *     fact, not a fresh request), dated the sheet's own date — UNLESS that
   *     date is in a CLOSED accounting period (P4), in which case it is dated
   *     today (PKT) and `relatesToDate` keeps the chain's ROOT business date.
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
        select: { vanId: true, driverId: true, date: true },
      });
      if (!sheet) throw new NotFoundException('Daily sheet not found.');

      const seeded = await tx.vanCashHandover.create({
        data: {
          vendorId,
          vanId: sheet.vanId,
          dailySheetId: sheetId,
          amount: newCashAmount,
          expectedAmount: newCashAmount,
          submittedById: sheet.driverId,
          date: sheet.date,
          status: VanCashHandoverStatus.PENDING,
          approvedAt: null,
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

    // Only non-voided chain rows count toward what the sheet has been recorded as.
    const currentTotal = round2(
      chain
        .filter((row) => row.status !== VanCashHandoverStatus.VOIDED)
        .reduce((sum, row) => sum + row.expectedAmount, 0),
    );
    const delta = round2(newCashAmount - currentTotal);
    if (delta === 0) return null;

    const original = chain.find((row) => row.correctsEntryId === null) ?? chain[0];
    const mostRecent = chain[chain.length - 1];

    if (original.status === VanCashHandoverStatus.PENDING && chain.length === 1) {
      const updated = await tx.vanCashHandover.update({
        where: { id: original.id },
        data: { amount: newCashAmount, expectedAmount: newCashAmount, version: { increment: 1 } },
      });

      await this.audit.log({
        vendorId,
        action: 'CORRECTED',
        entity: 'VanCashHandover',
        entityId: original.id,
        changes: {
          before: { amount: original.amount, expectedAmount: original.expectedAmount },
          after: { amount: updated.amount, expectedAmount: updated.expectedAmount },
        },
      });

      return updated;
    }

    // P4 redirect rule (R7): a correction whose posting date sits in a CLOSED
    // accounting period must not change that period's frozen numbers — it lands
    // in the CURRENT period and remembers the chain's ROOT business date.
    // (A read on the period store, not `tx`, is fine: periods only change via
    // close/reopen, never inside a correction transaction.)
    const redirected = await this.periodStore.isDateClosed(vendorId, mostRecent.date);
    const businessDate = original.relatesToDate ?? original.date;
    const redirectDate = redirected ? redirectDateForToday() : null;

    const correction = await tx.vanCashHandover.create({
      data: {
        vendorId,
        vanId: mostRecent.vanId,
        dailySheetId: sheetId,
        amount: delta,
        expectedAmount: delta,
        submittedById: mostRecent.submittedById,
        date: redirectDate ?? mostRecent.date,
        ...(redirectDate && { relatesToDate: businessDate }),
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
        after: {
          newCashAmount,
          delta,
          correctsEntryId: mostRecent.id,
          ...(redirectDate && {
            redirectedFrom: mostRecent.date.toISOString(),
            date: redirectDate.toISOString(),
            relatesToDate: businessDate.toISOString(),
          }),
        },
      },
    });

    return correction;
  }

  // ── Approval ─────────────────────────────────────────────────────────────

  async approveHandover(user: AuthUser, id: string, dto: ApproveHandoverDto) {
    const { updated, previousStatus, previousAmount, previousDate, previousRelatesToDate } =
      await this.prisma.$transaction(async (tx) => {
      const handover = await tx.vanCashHandover.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!handover) throw new NotFoundException('Van cash handover not found.');
      if (handover.status !== VanCashHandoverStatus.PENDING) {
        throw new BadRequestException('Only a PENDING handover can be approved.');
      }

      // P4 redirect rule (R7): approval is a system-of-record action, not a human
      // choice of date — a handover whose business date is in a CLOSED period is
      // approved INTO THE CURRENT period (no override permission needed) and
      // keeps its original date in `relatesToDate` ("for 12 Aug").
      const redirectDate = (await this.periodStore.isDateClosed(user.vendorId, handover.date))
        ? redirectDateForToday()
        : null;

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
          // R5 — the FINAL approved amount lands in `amount` (the ledger
          // figure every balance folds), so no reader has to know about an
          // adjustment. `expectedAmount` (the sheet figure) is left untouched;
          // variance = amount − expectedAmount.
          amount: approvedAmount,
          adjustmentReason: dto.adjustmentReason ?? null,
          ...(redirectDate && { date: redirectDate, relatesToDate: handover.relatesToDate ?? handover.date }),
          version: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        throw versionMismatch(handover.version, dto.version);
      }

      return {
        updated: await tx.vanCashHandover.findUniqueOrThrow({ where: { id } }),
        previousStatus: handover.status,
        previousAmount: handover.amount,
        previousDate: handover.date,
        previousRelatesToDate: handover.relatesToDate ?? null,
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
        before: {
          status: previousStatus,
          amount: previousAmount,
          date: previousDate?.toISOString?.() ?? null,
          relatesToDate: previousRelatesToDate?.toISOString?.() ?? null,
        },
        after: {
          status: updated.status,
          amount: updated.amount,
          approvedAmount: updated.approvedAmount,
          adjustmentReason: updated.adjustmentReason,
          date: updated.date?.toISOString?.() ?? null,
          relatesToDate: updated.relatesToDate?.toISOString?.() ?? null,
        },
      },
    });

    return updated;
  }

  // ── Office Cash Remittance (office -> owner / CEO / bank) ─────────────────
  //
  // The third cash-custody tier. Vendor-wide (no vanId — the office pool is
  // fungible once van handovers are APPROVED). Same lifecycle discipline as
  // VanCashHandover: PENDING -> APPROVED counts toward the balance; a post-
  // approval fix is a NEW row carrying the DELTA via correctsEntryId; a void is
  // a status flip, never a DELETE; optimistic concurrency via `version`.

  /**
   * Records a PENDING remittance. Over-remittance is a soft gate, never a hard
   * block (see the plan's real-world rationale): the row is always created, and
   * `wouldGoNegative` is returned so the caller can surface a warning / require
   * a note. `attachmentKey` is a Wasabi key already uploaded via the attachment
   * endpoint.
   */
  async createRemittance(user: AuthUser, dto: CreateRemittanceDto) {
    const availableBalance = round2(await this.computeAvailableBalance(user.vendorId));
    const wouldGoNegative = round2(availableBalance - dto.amount) < 0;

    // Over-remittance is a soft gate — allowed, but a note explaining the
    // shortfall is mandatory (plan §7). Enforced here so a direct API call
    // cannot bypass the dialog's client-side check.
    if (wouldGoNegative && !dto.note?.trim()) {
      throw new BadRequestException(
        `A note is required: this remittance exceeds recorded office cash (₨${availableBalance.toLocaleString()}) ` +
          `by ₨${round2(dto.amount - availableBalance).toLocaleString()}.`,
      );
    }

    await this.periodGuard.assertWritable(user.vendorId, [dto.date], { userId: user.userId });

    const created = await this.prisma.officeCashRemittance.create({
      data: {
        vendorId: user.vendorId,
        submittedAmount: dto.amount,
        amount: dto.amount,
        date: new Date(dto.date),
        destination: dto.destination,
        destinationName: dto.destinationName ?? null,
        reference: dto.reference ?? null,
        attachmentKey: dto.attachmentKey ?? null,
        note: dto.note ?? null,
        status: OfficeCashRemittanceStatus.PENDING,
        submittedById: user.userId,
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'OfficeCashRemittance',
      entityId: created.id,
      changes: {
        after: {
          amount: created.amount,
          date: created.date,
          destination: created.destination,
          destinationName: created.destinationName,
          reference: created.reference,
          status: created.status,
        },
      },
    });

    return { ...created, wouldGoNegative, availableBalance };
  }

  /**
   * Approves a PENDING remittance. Mirrors approveHandover, plus:
   *   - segregation of duties — the recorder cannot approve their own row;
   *   - a soft negative-balance gate — if the approval drives office cash below
   *     zero, `negativeOverrideReason` is mandatory (but nothing is blocked once
   *     it is supplied).
   * When `approvedAmount` differs from the row's `amount`, `amount` is rewritten
   * to the approved value (the running balance and availableBalance both fold
   * `amount`, so the approved figure must land there) and the original amount is
   * preserved in the audit trail + `adjustmentReason`.
   */
  async approveRemittance(user: AuthUser, id: string, dto: ApproveRemittanceDto) {
    const { updated, previousStatus, previousAmount } = await this.prisma.$transaction(async (tx) => {
      const row = await tx.officeCashRemittance.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!row) throw new NotFoundException('Office cash remittance not found.');
      if (row.status !== OfficeCashRemittanceStatus.PENDING) {
        throw new BadRequestException('Only a PENDING remittance can be approved.');
      }
      if (row.submittedById === user.userId) {
        throw new BadRequestException('You cannot approve a remittance you recorded yourself.');
      }

      const approvedAmount = dto.approvedAmount ?? row.amount;
      const approvedAmountChanged = approvedAmount !== row.amount;
      if (approvedAmountChanged && !dto.adjustmentReason) {
        throw new BadRequestException(
          'adjustmentReason is required when approvedAmount differs from the remittance amount.',
        );
      }

      // `computeAvailableBalance` counts only APPROVED remittances, so this row
      // (still PENDING) is not yet in it — the projection is simply
      // available - approvedAmount.
      const available = round2(await this.computeAvailableBalance(user.vendorId));
      const projected = round2(available - approvedAmount);
      if (projected < 0 && !dto.negativeOverrideReason) {
        throw new BadRequestException(
          `This approval drives office cash negative (₨${projected.toLocaleString()}). ` +
            'Provide negativeOverrideReason to proceed.',
        );
      }

      await this.periodGuard.assertWritable(user.vendorId, [row.date], { userId: user.userId });

      const claim = await tx.officeCashRemittance.updateMany({
        where: { id, vendorId: user.vendorId, version: dto.version },
        data: {
          status: OfficeCashRemittanceStatus.APPROVED,
          approvedById: user.userId,
          approvedAt: new Date(),
          approvedAmount,
          amount: approvedAmount,
          adjustmentReason: dto.adjustmentReason ?? null,
          negativeOverrideReason: dto.negativeOverrideReason ?? null,
          version: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        throw versionMismatch(row.version, dto.version);
      }

      return {
        updated: await tx.officeCashRemittance.findUniqueOrThrow({ where: { id } }),
        previousStatus: row.status,
        previousAmount: row.amount,
      };
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'APPROVED',
      entity: 'OfficeCashRemittance',
      entityId: id,
      changes: {
        before: { status: previousStatus, amount: previousAmount },
        after: {
          status: updated.status,
          amount: updated.amount,
          approvedAmount: updated.approvedAmount,
          adjustmentReason: updated.adjustmentReason,
          negativeOverrideReason: updated.negativeOverrideReason,
        },
      },
    });

    return updated;
  }

  /**
   * Voids a remittance (status flip to VOIDED — never a DELETE). SOP §8:
   *   - a still-PENDING row can be voided by its own creator (no extra grant
   *     needed) or by any `van_cash_ledger:remit_approve` holder;
   *   - an APPROVED row additionally requires `van_cash_ledger:remit_void`, and
   *     cannot be voided while it still has a live (non-voided) correction —
   *     the latest correction must be voided first (LIFO down the chain).
   */
  async voidRemittance(user: AuthUser, id: string, dto: VoidRemittanceDto) {
    const { updated, previousStatus } = await this.prisma.$transaction(async (tx) => {
      const row = await tx.officeCashRemittance.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!row) throw new NotFoundException('Office cash remittance not found.');
      if (row.status === OfficeCashRemittanceStatus.VOIDED) {
        throw new BadRequestException('This remittance is already voided.');
      }

      if (row.status === OfficeCashRemittanceStatus.PENDING) {
        // A creator may always retract their own pending remittance; anyone
        // else needs approver authority.
        if (row.submittedById !== user.userId) {
          const isApprover = await this.permissions.can(user.userId, 'van_cash_ledger:remit_approve');
          if (!isApprover) {
            throw new ForbiddenException('You may only void a pending remittance you recorded yourself.');
          }
        }
      }

      if (row.status === OfficeCashRemittanceStatus.APPROVED) {
        const canVoidApproved = await this.permissions.can(user.userId, 'van_cash_ledger:remit_void');
        if (!canVoidApproved) {
          throw new ForbiddenException(
            'Voiding an already-approved remittance requires the van_cash_ledger:remit_void permission.',
          );
        }
        const liveCorrection = await tx.officeCashRemittance.findFirst({
          where: {
            vendorId: user.vendorId,
            correctsEntryId: id,
            status: { not: OfficeCashRemittanceStatus.VOIDED },
          },
          select: { id: true },
        });
        if (liveCorrection) {
          throw new BadRequestException('Void the latest correction on this remittance first.');
        }
      }

      await this.periodGuard.assertWritable(user.vendorId, [row.date], { userId: user.userId });

      const claim = await tx.officeCashRemittance.updateMany({
        where: { id, vendorId: user.vendorId, version: dto.version },
        data: {
          status: OfficeCashRemittanceStatus.VOIDED,
          voidedById: user.userId,
          voidedAt: new Date(),
          voidReason: dto.voidReason,
          version: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        throw versionMismatch(row.version, dto.version);
      }

      return {
        updated: await tx.officeCashRemittance.findUniqueOrThrow({ where: { id } }),
        previousStatus: row.status,
      };
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'VOIDED',
      entity: 'OfficeCashRemittance',
      entityId: id,
      changes: {
        before: { status: previousStatus },
        after: { status: updated.status, voidReason: updated.voidReason },
      },
    });

    return updated;
  }

  /**
   * Corrects a remittance chain. `newAmount` is the intended NEW TOTAL for the
   * whole logical remittance (root + every non-voided correction). Mirrors
   * handlePostCloseCorrection:
   *   - a still-PENDING standalone original (no chain) is rewritten in place;
   *   - otherwise a NEW row carrying the DELTA (`newAmount - currentTotal`) is
   *     appended, itself PENDING, going through its own approval cycle.
   */
  async correctRemittance(user: AuthUser, id: string, dto: CorrectRemittanceDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const chain = await this.loadRemittanceChain(tx, user.vendorId, id);
      if (chain.length === 0) throw new NotFoundException('Office cash remittance not found.');

      const target = chain.find((r) => r.id === id);
      if (!target) throw new NotFoundException('Office cash remittance not found.');
      if (chain.some((r) => r.status === OfficeCashRemittanceStatus.VOIDED && r.correctsEntryId === null)) {
        throw new BadRequestException('This remittance has been voided and cannot be corrected.');
      }
      if (target.version !== dto.version) {
        throw versionMismatch(target.version, dto.version);
      }

      const nonVoided = chain.filter((r) => r.status !== OfficeCashRemittanceStatus.VOIDED);
      const currentTotal = round2(nonVoided.reduce((sum, r) => sum + r.amount, 0));
      const delta = round2(dto.newAmount - currentTotal);
      if (delta === 0) {
        throw new BadRequestException('The corrected amount is the same as the current total.');
      }

      const root = chain[0];
      const mostRecent = nonVoided[nonVoided.length - 1] ?? root;
      const isInPlace = chain.length === 1 && root.status === OfficeCashRemittanceStatus.PENDING;

      // A creator may correct their OWN still-pending remittance in place with
      // no extra grant; every other case (someone else's pending row, or an
      // already-approved chain) needs approver authority.
      if (!(isInPlace && root.submittedById === user.userId)) {
        const isApprover = await this.permissions.can(user.userId, 'van_cash_ledger:remit_approve');
        if (!isApprover) {
          throw new ForbiddenException(
            isInPlace
              ? 'You may only correct a pending remittance you recorded yourself.'
              : 'Correcting an approved remittance requires the van_cash_ledger:remit_approve permission.',
          );
        }
      }

      // Every date this correction touches: the target row and the row it will
      // rewrite / append after (identical in practice — corrections copy the date).
      await this.periodGuard.assertWritable(user.vendorId, [target.date, mostRecent.date], {
        userId: user.userId,
      });

      // PENDING standalone original — rewrite in place. CAS on `version` so two
      // concurrent in-place corrections cannot both land (matches approve/void).
      if (isInPlace) {
        const claim = await tx.officeCashRemittance.updateMany({
          where: { id: root.id, vendorId: user.vendorId, version: dto.version },
          data: {
            amount: dto.newAmount,
            destinationName: dto.destinationName ?? root.destinationName,
            reference: dto.reference ?? root.reference,
            note: dto.correctionReason,
            version: { increment: 1 },
          },
        });
        if (claim.count === 0) {
          throw versionMismatch(root.version, dto.version);
        }
        const updated = await tx.officeCashRemittance.findUniqueOrThrow({ where: { id: root.id } });
        await this.audit.log({
          vendorId: user.vendorId,
          userId: user.userId,
          userName: user.name,
          action: 'CORRECTED',
          entity: 'OfficeCashRemittance',
          entityId: root.id,
          changes: {
            before: { amount: root.amount },
            after: { amount: updated.amount, correctionReason: dto.correctionReason },
          },
        });
        return updated;
      }

      // APPROVED original / existing chain — append a PENDING DELTA row.
      // CAS-bump the parent (`mostRecent`) first: two concurrent corrections of
      // the same parent then serialise, and the loser gets a version mismatch,
      // so a parent can never end up with two live children.
      const parentClaim = await tx.officeCashRemittance.updateMany({
        where: { id: mostRecent.id, vendorId: user.vendorId, version: mostRecent.version },
        data: { version: { increment: 1 } },
      });
      if (parentClaim.count === 0) {
        throw new ConflictException(
          'Version mismatch: this remittance was corrected concurrently. Reload and retry.',
        );
      }

      const correction = await tx.officeCashRemittance.create({
        data: {
          vendorId: user.vendorId,
          submittedAmount: delta,
          amount: delta,
          date: mostRecent.date,
          destination: mostRecent.destination,
          destinationName: dto.destinationName ?? mostRecent.destinationName,
          reference: dto.reference ?? mostRecent.reference,
          note: dto.correctionReason,
          status: OfficeCashRemittanceStatus.PENDING,
          submittedById: user.userId,
          correctsEntryId: mostRecent.id,
        },
      });
      await this.audit.log({
        vendorId: user.vendorId,
        userId: user.userId,
        userName: user.name,
        action: 'CORRECTED',
        entity: 'OfficeCashRemittance',
        entityId: correction.id,
        changes: {
          before: { currentTotal },
          after: {
            newAmount: dto.newAmount,
            delta,
            correctsEntryId: mostRecent.id,
            correctionReason: dto.correctionReason,
          },
        },
      });
      return correction;
    });

    return result;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async getPendingHandovers(vendorId: string, vanId?: string) {
    const rows = await this.prisma.vanCashHandover.findMany({
      where: { vendorId, status: VanCashHandoverStatus.PENDING, ...(vanId && { vanId }) },
      include: {
        van: { select: { id: true, plateNumber: true } },
        submittedBy: { select: { id: true, name: true } },
        dailySheet: {
          select: {
            id: true,
            date: true,
            crew: { where: { role: CrewRole.SALESMAN }, select: { user: { select: { name: true } } } },
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    // Flattened for the Pending Approvals panel — the driver is who actually
    // submits a handover (submittedById === dailySheet.driverId, see
    // createHandoverForClosedSheet), so it doubles as "driverName" here.
    return rows.map((row) => ({
      id: row.id,
      dailySheetId: row.dailySheetId,
      vanPlateNumber: row.van.plateNumber,
      driverName: row.submittedBy?.name ?? '—',
      salesmanName: row.dailySheet.crew[0]?.user.name ?? null,
      date: row.date,
      amount: row.amount,
      version: row.version,
    }));
  }

  /** PENDING office->owner remittances awaiting approval (vendor-wide). */
  async getPendingRemittances(vendorId: string) {
    return this.prisma.officeCashRemittance.findMany({
      where: { vendorId, status: OfficeCashRemittanceStatus.PENDING },
      include: {
        submittedBy: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  /** Resolves a remittance's stored attachment key (vendor-scoped); 404 if the row or its attachment is missing. */
  async getRemittanceAttachmentKey(vendorId: string, id: string): Promise<string> {
    const row = await this.prisma.officeCashRemittance.findFirst({
      where: { id, vendorId },
      select: { attachmentKey: true },
    });
    if (!row) throw new NotFoundException('Office cash remittance not found.');
    if (!row.attachmentKey) throw new NotFoundException('This remittance has no attachment.');
    return row.attachmentKey;
  }

  async getStats(vendorId: string, query: VanCashLedgerStatsQueryDto): Promise<VanCashLedgerStats> {
    const { vanId } = query;
    const { from, dateFilter } = resolveWindow(query);

    const [period, broughtForward, pendingHandoverCount, pendingRemittanceCount, liveTotals] = await Promise.all([
      this.aggregateBuckets(vendorId, vanId, dateFilter),
      from ? this.computeBroughtForward(vendorId, vanId, from) : Promise.resolve(0),
      this.prisma.vanCashHandover.count({
        where: { vendorId, status: VanCashHandoverStatus.PENDING, ...(vanId && { vanId }) },
      }),
      // Office->owner remittances are vendor-wide — a van-scoped view does not attribute them.
      vanId
        ? Promise.resolve(0)
        : this.prisma.officeCashRemittance.count({
            where: { vendorId, status: OfficeCashRemittanceStatus.PENDING },
          }),
      // The live all-time position — when the query has no window it IS `period`,
      // so it is reused rather than re-aggregated.
      dateFilter ? this.computeAvailableBalance(vendorId, vanId) : Promise.resolve(null),
    ]);

    const statement = summarizeTotals(period, broughtForward);
    const availableBalance = liveTotals ?? statement.net;

    return {
      totalCashIn: statement.totalCashIn,
      totalExpense: statement.totalExpenses,
      pendingHandoverCount,
      availableBalance: round2(availableBalance),
      totalRemitted: statement.ownerTransfer,
      pendingRemittanceCount,
      totalFuelCardTopUps: statement.fuelCard,
      totalStandaloneCrewCash: statement.crewCash,
      sheetCashIn: statement.sheetCashIn,
      officeCashIn: statement.officeCashIn,
      officeExpenses: statement.officeExpenses,
      payrollCash: statement.payrollCash,
      crewCash: statement.crewCash,
      broughtForward: statement.broughtForward,
      expectedClosing: statement.expectedClosing,
    };
  }

  /**
   * Paginated cash timeline (newest first) + `meta.broughtForward` +
   * `meta.dayStatements`. See {@link collectWindow} for what the window contains
   * and how it is ordered / folded. `user` is optional: it is only used to
   * compute the per-row `canVoid` / `canEdit` / `editBlockedReason` flags, so callers
   * without one (analytics, tests) simply get `false` / `null` everywhere.
   */
  async getTimeline(
    vendorId: string,
    query: VanCashLedgerTimelineQueryDto,
    user?: AuthUser,
  ): Promise<VanCashLedgerTimelineResult> {
    const { page = 1, limit = 20 } = query;
    // P3 entry filters. They are applied AFTER the fold (see below) so they can
    // never change a row's runningBalance or a day statement (invariant I5).
    const filters = resolveTimelineFilters(query);
    const includePending = !!filters.status?.includes('PENDING');
    const { rows, broughtForward, pendingRows } = await this.collectWindow(vendorId, query, { includePending });

    // Day statements are computed over the WHOLE window (oldest-first, before
    // the newest-first reversal / pagination) so a day split across pages still
    // carries complete totals — then narrowed to the days on the returned page.
    const allDays = buildDayStatements(rows, broughtForward);

    // Running balance is folded oldest→newest (each row's `runningBalance` is
    // the cumulative total up to and including it), but the timeline is DISPLAYED
    // newest-first — reverse the fully-folded set before paginating so page 1
    // carries the most recent movements with their balances intact.
    // Filters run on the fully folded (base + optional PENDING memo) rows, then the
    // FILTERED list is what gets paginated.
    const ordered = pendingRows?.length ? mergePendingRows(rows, pendingRows, broughtForward) : rows;
    const filterActive = hasActiveFilters(filters);
    const visible = filterActive ? ordered.filter((row) => matchesFilters(row, filters)) : ordered;
    const newestFirst = [...visible].reverse();
    const total = newestFirst.length;
    const skip = (page - 1) * limit;
    const pageRows = newestFirst.slice(skip, skip + limit);

    await this.applyPeriodFlags(vendorId, pageRows, user);
    if (user) await this.applyRowPermissions(user, pageRows);

    const pageDays = new Set(pageRows.map((row) => pktDay(row.date)));
    const dayStatements: Record<string, CashLedgerDayStatement> = {};
    for (const day of allDays) {
      if (pageDays.has(day.date)) dayStatements[day.date] = day;
    }

    const paged = paginate(pageRows, total, page, limit);
    const filtered: CashLedgerFilteredMeta | undefined = filterActive
      ? { active: true, ...summarizeFiltered(visible) }
      : undefined;
    return {
      ...paged,
      meta: { ...paged.meta, broughtForward: round2(broughtForward), dayStatements, ...(filtered && { filtered }) },
    };
  }

  /**
   * GET /van-cash-ledger/summary — the reconciliation header for a window.
   * Built from the SAME collected rows as the timeline (one source of truth):
   * `statement` folds them with `buildStatement`, `trend` / `firstNegativeDate`
   * come from the per-day statements. `availableBalance` is the live all-time
   * figure. Van scope (`vanId`) zeroes every vendor-wide tier.
   */
  async getSummary(vendorId: string, query: VanCashLedgerStatsQueryDto): Promise<CashLedgerSummary> {
    const { vanId } = query;
    const { from, to } = resolveWindow(query);

    const [{ rows, broughtForward }, availableBalance, pendingHandovers, pendingRemittances, pendingAdvances] =
      await Promise.all([
        this.collectWindow(vendorId, query),
        this.computeAvailableBalance(vendorId, vanId),
        this.prisma.vanCashHandover.aggregate({
          where: { vendorId, status: VanCashHandoverStatus.PENDING, ...(vanId && { vanId }) },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        // Remittances and payroll advances are vendor-wide — not attributable to one van.
        vanId
          ? Promise.resolve(null)
          : this.prisma.officeCashRemittance.aggregate({
              where: { vendorId, status: OfficeCashRemittanceStatus.PENDING },
              _sum: { amount: true },
              _count: { _all: true },
            }),
        vanId
          ? Promise.resolve(null)
          : this.prisma.staffLedgerEntry.aggregate({
              where: {
                vendorId,
                category: StaffLedgerCategory.ADVANCE,
                status: LedgerEntryStatus.PENDING,
                amount: { lt: 0 },
              },
              _sum: { amount: true },
              _count: { _all: true },
            }),
      ]);

    const statement = buildStatement(rows, broughtForward);
    const days = buildDayStatements(rows, broughtForward);

    // Approved handover rows dated in the window (van-scoped when vanId).
    const handoverRows = rows.filter((row) => row.bucket === 'SHEET_CASH_IN');
    const approvalAdjustments = round2(handoverRows.reduce((sum, row) => sum + (row.variance ?? 0), 0));
    const originalSheetIds = handoverRows
      .filter((row) => row.type === 'CASH_IN' && row.dailySheetId)
      .map((row) => row.dailySheetId as string);
    const sheetBreakdown = await this.computeSheetBreakdown(vendorId, [...new Set(originalSheetIds)]);

    return {
      scope: vanId ? 'VAN' : 'OFFICE',
      range: { from: from ? vendorDateString(from) : null, to: to ? vendorDateString(to) : null },
      statement: {
        broughtForward: statement.broughtForward,
        sheetCashIn: statement.sheetCashIn,
        officeCashIn: statement.officeCashIn,
        totalCashIn: statement.totalCashIn,
        officeExpenses: statement.officeExpenses,
        payrollCash: statement.payrollCash,
        crewCash: statement.crewCash,
        totalExpenses: statement.totalExpenses,
        ownerTransfer: statement.ownerTransfer,
        fuelCard: statement.fuelCard,
        net: statement.net,
        expectedClosing: statement.expectedClosing,
      },
      availableBalance: round2(availableBalance),
      memo: {
        pendingHandovers: {
          count: pendingHandovers._count._all,
          amount: round2(pendingHandovers._sum.amount ?? 0),
        },
        pendingRemittances: {
          count: pendingRemittances?._count._all ?? 0,
          amount: round2(pendingRemittances?._sum.amount ?? 0),
        },
        pendingAdvances: {
          count: pendingAdvances?._count._all ?? 0,
          // Advances are stored as negative debits — report the magnitude.
          amount: round2(Math.abs(pendingAdvances?._sum.amount ?? 0)),
        },
        approvalAdjustments,
        sheetBreakdown,
        firstNegativeDate: days.find((day) => day.closing < 0)?.date ?? null,
      },
      trend: days.map((day) => ({ date: day.date, closing: day.closing })),
    };
  }

  /**
   * P4 (period service) — the OFFICE-WIDE (no van) closing balance as of the end
   * of PKT day `lastDay`: the net of EVERYTHING dated up to and including it,
   * through the very same `aggregateBuckets` definition every other balance uses.
   */
  async getClosingBalanceAsOf(vendorId: string, lastDay: string): Promise<number> {
    const totals = await this.aggregateBuckets(vendorId, undefined, { lte: vendorDayEnd(lastDay) });
    return round2(summarizeTotals(totals, 0).net);
  }

  /**
   * P4 (period service) — the office-scope reconciliation statement for the PKT
   * range `firstDay`..`lastDay` (inclusive), identical to `getSummary(...).statement`
   * for the same range: `broughtForward` = everything dated before `firstDay`.
   */
  async getStatementForRange(
    vendorId: string,
    firstDay: string,
    lastDay: string,
  ): Promise<CashLedgerSummary['statement']> {
    const { rows, broughtForward } = await this.collectWindow(vendorId, { from: firstDay, to: lastDay });
    return buildStatement(rows, broughtForward);
  }

  /**
   * GET /van-cash-ledger/daily-summary — the table view: one reconciliation row
   * per PKT day / week / month, newest first. Built from the SAME collected
   * rows as `getSummary` (entry filters never apply), so `totals` equals
   * `getSummary().statement` for the same range (invariant I1). Pending memo
   * counts are date-scoped here: sheet handovers (van-scoped when `vanId`) and,
   * vendor-wide only, owner transfers awaiting approval.
   */
  async getDailySummary(vendorId: string, query: CashLedgerDailySummaryQueryDto): Promise<CashLedgerDailySummary> {
    const { vanId } = query;
    const group = query.group ?? 'day';
    const { from, to, dateFilter } = resolveWindow(query);

    const [{ rows, broughtForward }, pendingHandovers, pendingRemittances] = await Promise.all([
      this.collectWindow(vendorId, { vanId, from: query.from, to: query.to }),
      this.prisma.vanCashHandover.findMany({
        where: {
          vendorId,
          status: VanCashHandoverStatus.PENDING,
          ...(vanId && { vanId }),
          ...(dateFilter && { date: dateFilter }),
        },
        select: { date: true },
      }),
      // Owner transfers are vendor-wide — not attributable to one van.
      vanId
        ? Promise.resolve([] as Array<{ date: Date }>)
        : this.prisma.officeCashRemittance.findMany({
            where: {
              vendorId,
              status: OfficeCashRemittanceStatus.PENDING,
              ...(dateFilter && { date: dateFilter }),
            },
            select: { date: true },
          }),
    ]);

    const range = { from: from ? vendorDateString(from) : null, to: to ? vendorDateString(to) : null };
    const { rows: periodRows, totals, truncated } = buildDailySummary({
      rows,
      broughtForward,
      from: range.from,
      to: range.to,
      group,
      includeEmpty: query.includeEmpty === true,
      pendingDays: [...pendingHandovers, ...pendingRemittances].map((row) => vendorDateString(row.date)),
    });

    return { group, scope: vanId ? 'VAN' : 'OFFICE', range, rows: periodRows, totals, truncated };
  }

  /**
   * GET /van-cash-ledger/sheets/:sheetId/cash-breakdown — how one sheet's
   * handover was derived. `collected` is the sheet's frozen close-time
   * `cashCollected`; expenses / crew cash are the sheet's live totals; the
   * chain totals cover every non-voided handover row (original + corrections).
   * 404 when the sheet is not this vendor's or has no handover at all.
   */
  async getSheetCashBreakdown(vendorId: string, sheetId: string): Promise<SheetCashBreakdown> {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
      select: { id: true, date: true, cashCollected: true },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found.');

    const chain = await this.prisma.vanCashHandover.findMany({
      where: { vendorId, dailySheetId: sheetId },
      include: { approvedBy: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (chain.length === 0) throw new NotFoundException('This sheet has no cash handover.');

    const [expenseAgg, crewAgg] = await Promise.all([
      this.prisma.expense.aggregate({
        where: { vendorId, dailySheetId: sheetId, paidFromCash: true },
        _sum: { amount: true },
      }),
      this.prisma.crewCashDistribution.aggregate({
        where: { vendorId, dailySheetId: sheetId },
        _sum: { amount: true },
      }),
    ]);

    const collected = sheet.cashCollected ?? 0;
    const expenses = expenseAgg._sum.amount ?? 0;
    const crewCash = crewAgg._sum.amount ?? 0;
    const netFromSheet = Math.max(0, collected - expenses - crewCash);

    const live = chain.filter((row) => row.status !== VanCashHandoverStatus.VOIDED);
    const expected = live.reduce((sum, row) => sum + row.expectedAmount, 0);
    const approved = live.reduce((sum, row) => sum + row.amount, 0);
    const original = chain.find((row) => row.correctsEntryId === null) ?? chain[0];

    return {
      dailySheetId: sheet.id,
      sheetShortId: shortSheetId(sheet.id),
      sheetDate: sheet.date.toISOString(),
      collected: round2(collected),
      expenses: round2(expenses),
      crewCash: round2(crewCash),
      netFromSheet: round2(netFromSheet),
      other: round2(expected - netFromSheet),
      expected: round2(expected),
      approved: round2(approved),
      variance: round2(approved - expected),
      adjustmentReason: original.adjustmentReason ?? null,
      approvedByName: original.approvedBy?.name ?? null,
    };
  }

  /**
   * Aggregated Sheet Cash Breakdown for the given (original, approved) handover
   * sheets — a fixed number of GROUP BY / aggregate queries, never one per sheet.
   * Per-sheet `net` is floored at 0 exactly like the sheet's own net-to-hand-in.
   * `other` = Σ expectedAmount over EVERY non-voided handover row of those sheets
   * (corrections included) − net, so the breakdown always reconciles to what the
   * ledger was told to expect.
   *
   * NOTE: `collected` is DailySheet.cashCollected, frozen at close, while
   * expenses / crewCash are live sums — a post-close correction therefore moves
   * `expenses` / `crewCash` (and the expected chain) but not `collected`; the
   * difference is absorbed by `other`, never lost.
   */
  private async computeSheetBreakdown(
    vendorId: string,
    sheetIds: string[],
  ): Promise<CashLedgerSummary['memo']['sheetBreakdown']> {
    if (sheetIds.length === 0) {
      return { sheets: 0, collected: 0, expenses: 0, crewCash: 0, net: 0, other: 0 };
    }

    const [sheets, expenseGroups, crewGroups, chainAgg] = await Promise.all([
      this.prisma.dailySheet.findMany({
        where: { vendorId, id: { in: sheetIds } },
        select: { id: true, cashCollected: true },
      }),
      this.prisma.expense.groupBy({
        by: ['dailySheetId'],
        where: { vendorId, dailySheetId: { in: sheetIds }, paidFromCash: true },
        _sum: { amount: true },
      }),
      this.prisma.crewCashDistribution.groupBy({
        by: ['dailySheetId'],
        where: { vendorId, dailySheetId: { in: sheetIds } },
        _sum: { amount: true },
      }),
      this.prisma.vanCashHandover.aggregate({
        where: { vendorId, dailySheetId: { in: sheetIds }, status: { not: VanCashHandoverStatus.VOIDED } },
        _sum: { expectedAmount: true },
      }),
    ]);

    const expenseBySheet = new Map(expenseGroups.map((g) => [g.dailySheetId, g._sum.amount ?? 0]));
    const crewBySheet = new Map(crewGroups.map((g) => [g.dailySheetId, g._sum.amount ?? 0]));

    let collected = 0;
    let expenses = 0;
    let crewCash = 0;
    let net = 0;
    for (const sheet of sheets) {
      const sheetExpenses = expenseBySheet.get(sheet.id) ?? 0;
      const sheetCrew = crewBySheet.get(sheet.id) ?? 0;
      collected += sheet.cashCollected;
      expenses += sheetExpenses;
      crewCash += sheetCrew;
      net += Math.max(0, sheet.cashCollected - sheetExpenses - sheetCrew);
    }
    const expected = chainAgg._sum.expectedAmount ?? 0;

    return {
      sheets: sheetIds.length,
      collected: round2(collected),
      expenses: round2(expenses),
      crewCash: round2(crewCash),
      net: round2(net),
      other: round2(expected - net),
    };
  }

  /**
   * Stamps `canVoid` / `canEdit` / `editBlockedReason` on the given (page)
   * rows. Each permission is resolved lazily and AT MOST ONCE per request; a row
   * that is already voided can never be voided or edited again.
   *   - manual cash-in (OPENING_BALANCE): van_cash_ledger:manage (edit + void);
   *   - crew cash: void = crew_cash:delete; edit = crew_cash:edit AND the payroll
   *     twin is not rolled into a locked payroll period — when the user may edit
   *     but the twin IS locked, `canEdit` is false and `editBlockedReason`
   *     explains "void and re-record";
   *   - fuel-card top-up: fuel_cards:topup_void (void only).
   */
  private async applyRowPermissions(user: AuthUser, rows: VanCashLedgerRow[]): Promise<void> {
    let manage: Promise<boolean> | undefined;
    let crewCashDelete: Promise<boolean> | undefined;
    let crewCashEdit: Promise<boolean> | undefined;
    let fuelCard: Promise<boolean> | undefined;
    for (const row of rows) {
      row.canEdit = false;
      row.editBlockedReason = null;
      if (row.isVoided) {
        row.canVoid = false;
        continue;
      }
      if (row.type === 'OPENING_BALANCE') {
        manage ??= this.permissions.can(user.userId, 'van_cash_ledger:manage');
        const allowed = await manage;
        row.canVoid = allowed;
        row.canEdit = allowed;
      } else if (row.type === 'STANDALONE_CREW_CASH_OUT') {
        crewCashDelete ??= this.permissions.can(user.userId, 'crew_cash:delete');
        crewCashEdit ??= this.permissions.can(user.userId, 'crew_cash:edit');
        row.canVoid = await crewCashDelete;
        if (await crewCashEdit) {
          if (TWIN_LOCKED_ROWS.has(row)) {
            row.editBlockedReason = STANDALONE_CREW_CASH_LOCKED_REASON;
          } else {
            row.canEdit = true;
          }
        }
      } else if (row.type === 'FUEL_CARD_TOPUP_OUT') {
        fuelCard ??= this.permissions.can(user.userId, 'fuel_cards:topup_void');
        row.canVoid = await fuelCard;
      }

      // P4 — a row in a CLOSED accounting period can only be changed by an
      // overrider. Everyone else loses the flags (and is told why when the row
      // would otherwise have been actionable); an overrider keeps them and the
      // client triggers the override dialog on the server's PERIOD_CLOSED rejection.
      if (row.periodClosed && !row.canOverride) {
        const actionable = row.canEdit || row.canVoid;
        row.canEdit = false;
        row.canVoid = false;
        if (actionable && !row.editBlockedReason) {
          row.editBlockedReason =
            `This entry belongs to a closed accounting period (${periodDisplayLabel(row.periodLabel)}). ` +
            'Ask an admin to make this change.';
        }
      }
    }
  }

  /**
   * P4 — stamps `periodLabel` / `periodClosed` / `canOverride` on the returned
   * page. The closed-label set is loaded ONCE per request; with no closed
   * period nothing else is done per row (and the override permission is never
   * looked up). `canOverride` is resolved lazily, at most once, and only when a
   * row of the page is actually in a closed period.
   */
  private async applyPeriodFlags(vendorId: string, rows: VanCashLedgerRow[], user?: AuthUser): Promise<void> {
    const closed = await this.periodStore.getClosedLabels(vendorId);
    let anyClosed = false;
    for (const row of rows) {
      row.periodLabel = periodLabelOf(row.date);
      row.periodClosed = closed.size > 0 && closed.has(row.periodLabel);
      row.canOverride = false;
      if (row.periodClosed) anyClosed = true;
    }
    if (!anyClosed || !user) return;
    const canOverride = await this.permissions.can(user.userId, OVERRIDE_LOCK_PERMISSION);
    for (const row of rows) row.canOverride = canOverride;
  }

  /**
   * The window's rows in deterministic ledger order (oldest first) with
   * `runningBalance` already folded from the brought-forward balance — the ONE
   * routine both getTimeline and getSummary read. Unlike `ExpenseCenterService.getTimeline`'s
   * bounded-window fetch-then-merge, this fetches every in-window row and folds
   * the running balance once over the full sorted set before paginating — an
   * accepted trade-off given Van Cash Ledger's volume (at most one handover per
   * van per day, plus its related cash-out rows) is orders of magnitude smaller
   * than the general Expense Center dataset.
   *
   * WINDOW + BROUGHT FORWARD. Every source (manual cash-in included) is
   * filtered by the SAME PKT `from`/`to` window on its own date column. When
   * `from` is set, everything dated BEFORE it is summed with indexed aggregates
   * (the identical source definitions, see `sourceWhere`) into
   * `meta.broughtForward`, and the running-balance fold starts from that value —
   * so the first in-window row already carries the true balance instead of 0.
   *
   * ORDER. PKT day -> createdAt -> bucket rank (cash-in before cash-out) -> id
   * (see cash-ledger-sort.ts) — never an arbitrary same-day order, so a payout
   * can not be folded before the receipt that funded it.
   *
   * CASH-OUT SCOPE — office cash only. A cash-paid Expense that belongs to a
   * Daily Sheet (or WALK_IN sheet) is ALREADY netted out of that sheet's
   * `VanCashHandover.amount` (= `resolveSheetCash().cashExpected` =
   * `netToHandIn`), so folding it in again would double-count. We therefore
   * include only Expense rows with `dailySheetId: null`, plus the payroll rows
   * that actually moved cash (POSTED ADVANCE debits and CASH settlements —
   * R6, see cash-ledger-buckets.ts), plus the vendor-wide tiers (owner
   * remittances, fuel-card top-ups, standalone crew cash). Sheet-synced
   * CrewCashDistribution is `dailySheetId`-mandatory and always inside a
   * handover, so it is not a source here at all.
   */
  private async collectWindow(
    vendorId: string,
    query: { vanId?: string; from?: string; to?: string },
    opts?: { includePending?: boolean },
  ): Promise<{ rows: VanCashLedgerRow[]; broughtForward: number; pendingRows?: VanCashLedgerRow[] }> {
    const { vanId } = query;
    const { from, dateFilter } = resolveWindow(query);

    const [
      broughtForward,
      openingRows,
      cashInRows,
      expenseRows,
      advanceRows,
      settlementRows,
      remittanceRows,
      fuelCardTopUpRows,
      standaloneCrewCashRows,
    ] = await Promise.all([
      from ? this.computeBroughtForward(vendorId, vanId, from) : Promise.resolve(0),
      this.buildOpeningBalanceRows(vendorId, vanId, dateFilter),
      this.prisma.vanCashHandover.findMany({
        where: sourceWhere.handover(vendorId, vanId, dateFilter),
        include: {
          van: { select: { plateNumber: true } },
          submittedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
        },
        orderBy: { date: 'asc' },
      }),
      this.prisma.expense.findMany({
        where: sourceWhere.officeExpense(vendorId, vanId, dateFilter),
        select: {
          id: true,
          category: true,
          amount: true,
          paidFromCash: true,
          description: true,
          date: true,
          createdAt: true,
          updatedAt: true,
          dailySheetId: true,
          fuelLog: { select: { id: true } },
          vehicleServiceRecord: { select: { id: true } },
          van: { select: { plateNumber: true } },
          createdById: true,
          createdBy: { select: { name: true } },
          dailySheet: { select: { isClosed: true } },
        },
        orderBy: { date: 'asc' },
      }),
      // Payroll cash is vendor-wide (StaffLedgerEntry has no van relation) —
      // excluded from a van-scoped view, same as remittances.
      vanId
        ? Promise.resolve([])
        : this.prisma.staffLedgerEntry.findMany({
            where: sourceWhere.payrollAdvance(vendorId, dateFilter),
            select: {
              id: true,
              category: true,
              status: true,
              amount: true,
              description: true,
              effectiveDate: true,
              createdAt: true,
              userId: true,
              user: { select: { name: true } },
              createdById: true,
              createdBy: { select: { name: true } },
              payrollEntryId: true,
            },
            orderBy: { effectiveDate: 'asc' },
          }),
      vanId
        ? Promise.resolve([])
        : this.prisma.settlement.findMany({
            where: sourceWhere.cashSettlement(vendorId, dateFilter),
            select: {
              id: true,
              amount: true,
              method: true,
              paidAt: true,
              createdAt: true,
              payrollEntry: { select: { user: { select: { id: true, name: true } } } },
              paidById: true,
              paidBy: { select: { name: true } },
            },
            orderBy: { paidAt: 'asc' },
          }),
      // NOTE: CrewCashDistribution is intentionally NOT a source here — every
      // crew-cash row is `dailySheetId`-mandatory and already netted out of that
      // sheet's VanCashHandover (see the CASH-OUT SCOPE note above).

      // Office->owner remittances are vendor-wide and cannot be attributed to a
      // single van — excluded from a van-scoped view. VOIDED rows are still
      // fetched so the timeline can show the struck-through audit row; they
      // fold in as amount 0.
      vanId
        ? Promise.resolve([] as Array<
            OfficeCashRemittance & {
              submittedBy: { name: string } | null;
              approvedBy: { name: string } | null;
              voidedBy: { name: string } | null;
            }
          >)
        : this.prisma.officeCashRemittance.findMany({
            where: sourceWhere.remittance(
              vendorId,
              [OfficeCashRemittanceStatus.APPROVED, OfficeCashRemittanceStatus.VOIDED],
              dateFilter,
            ),
            include: {
              submittedBy: { select: { name: true } },
              approvedBy: { select: { name: true } },
              voidedBy: { select: { name: true } },
            },
            orderBy: { date: 'asc' },
          }),
      // Fuel Card top-ups are vendor-wide — excluded from a van-scoped view,
      // same as remittances. VOIDED rows are still fetched for the audit row.
      vanId
        ? Promise.resolve([] as Array<
            FuelCardTopUp & {
              fuelCard: { name: string } | null;
              createdBy: { name: string } | null;
              voidedBy: { name: string } | null;
            }
          >)
        : this.prisma.fuelCardTopUp.findMany({
            where: sourceWhere.fuelCardTopUp(vendorId, [FuelCardTopUpStatus.ACTIVE, FuelCardTopUpStatus.VOIDED], dateFilter),
            include: {
              fuelCard: { select: { name: true } },
              createdBy: { select: { name: true } },
              voidedBy: { select: { name: true } },
            },
            orderBy: { date: 'asc' },
          }),
      // Standalone Crew Cash is a vendor-wide cash tier too. Its own
      // StaffLedgerEntry is category CREW_CASH, which the payroll-advance
      // source above never reads (ADVANCE only), so there is no double-count
      // risk pulling it in here as its own source.
      vanId
        ? Promise.resolve([] as Array<
            StandaloneCrewCashExpense & {
              employee: { name: string } | null;
              createdBy: { name: string } | null;
              voidedBy: { name: string } | null;
              staffLedgerEntry: { payrollEntryId: string | null; status: LedgerEntryStatus } | null;
            }
          >)
        : this.prisma.standaloneCrewCashExpense.findMany({
            where: sourceWhere.standaloneCrewCash(
              vendorId,
              [StandaloneCrewCashStatus.ACTIVE, StandaloneCrewCashStatus.VOIDED],
              dateFilter,
            ),
            include: {
              employee: { select: { name: true } },
              createdBy: { select: { name: true } },
              voidedBy: { select: { name: true } },
              // The payroll twin decides whether an edit is still possible (see standalone-crew-cash-lock.util).
              staffLedgerEntry: { select: { payrollEntryId: true, status: true } },
            },
            orderBy: { date: 'asc' },
          }),
    ]);

    const merged: VanCashLedgerRow[] = [...openingRows];
    for (const row of cashInRows) merged.push(this.normalizeCashIn(row));
    for (const row of expenseRows) {
      // Plain Expense edits are detectable from updatedAt (P1). The grace window
      // absorbs create-flow follow-up writes; P2 replaces this with real edit tracking.
      const edited = !!row.updatedAt && row.updatedAt.getTime() - row.createdAt.getTime() > EDIT_GRACE_MS;
      merged.push(
        this.normalizeCashOut(normalizeExpenseRow(row), row.createdAt, 'OFFICE_EXPENSE', {
          isEdited: edited,
          lastEditedAt: edited ? row.updatedAt.toISOString() : null,
          recordedById: row.createdById ?? null,
        }),
      );
    }
    for (const row of advanceRows) {
      // Belt-and-braces with the where clause: R6 has ONE classifier.
      if (classifyStaffLedgerEntry(row) !== 'PAYROLL_CASH') continue;
      merged.push(
        this.normalizeCashOut(normalizeStaffLedgerRow(row), row.createdAt, 'PAYROLL_CASH', {
          notes: row.description?.trim() || null,
          employeeId: row.userId ?? null,
          recordedById: row.createdById ?? null,
        }),
      );
    }
    for (const row of settlementRows) {
      if (!isCashSettlement(row.method)) continue;
      merged.push(this.normalizeSettlementOut(row));
    }
    for (const row of remittanceRows) merged.push(this.normalizeRemittanceOut(row));
    for (const row of fuelCardTopUpRows) merged.push(this.normalizeFuelCardTopUpOut(row));
    for (const row of standaloneCrewCashRows) merged.push(this.normalizeStandaloneCrewCashOut(row));

    merged.sort(compareLedgerRows);

    let running = broughtForward;
    for (const row of merged) {
      running = round2(running + row.amount);
      row.runningBalance = running;
    }

    // P3: PENDING memo rows ride alongside (never inside) the folded base rows,
    // and only when the caller asked — the default result is unchanged.
    if (!opts?.includePending) return { rows: merged, broughtForward };
    return { rows: merged, broughtForward, pendingRows: await this.loadPendingMemoRows(vendorId, vanId, dateFilter) };
  }

  /**
   * P3 — PENDING handovers (van-scoped like the rest) and PENDING owner
   * transfers (vendor-wide, hidden in a van scope), normalised with the regular
   * normalisers but as MEMO rows: `amount` 0 (the real figure stays in
   * `displayAmount`) and `status` PENDING, so they can never affect the
   * running-balance fold, the day statements or the filtered subtotal.
   */
  private async loadPendingMemoRows(
    vendorId: string,
    vanId: string | undefined,
    range: DateRange | undefined,
  ): Promise<VanCashLedgerRow[]> {
    const [pendingHandovers, pendingRemittances] = await Promise.all([
      this.prisma.vanCashHandover.findMany({
        where: {
          vendorId,
          status: VanCashHandoverStatus.PENDING,
          ...(vanId && { vanId }),
          ...(range && { date: range }),
        },
        include: {
          van: { select: { plateNumber: true } },
          submittedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
        },
        orderBy: { date: 'asc' },
      }),
      vanId
        ? Promise.resolve([] as Array<
            OfficeCashRemittance & {
              submittedBy: { name: string } | null;
              approvedBy: { name: string } | null;
              voidedBy: { name: string } | null;
            }
          >)
        : this.prisma.officeCashRemittance.findMany({
            where: sourceWhere.remittance(vendorId, [OfficeCashRemittanceStatus.PENDING], range),
            include: {
              submittedBy: { select: { name: true } },
              approvedBy: { select: { name: true } },
              voidedBy: { select: { name: true } },
            },
            orderBy: { date: 'asc' },
          }),
    ]);

    const memo = (row: VanCashLedgerRow): VanCashLedgerRow => ({
      ...row,
      amount: 0,
      status: VanCashHandoverStatus.PENDING,
    });
    return [
      ...pendingHandovers.map((row) => memo(this.normalizeCashIn(row))),
      ...pendingRemittances.map((row) => memo(this.normalizeRemittanceOut(row))),
    ];
  }

  // ── Entry history (P2) ───────────────────────────────────────────────────

  /**
   * GET /van-cash-ledger/entries/:sourceType/:sourceRecordId/history — the
   * newest-first change history of one ledger entry. Re-uses the generic
   * `AuditLog` (no new store): every event is an audit row of the record's own
   * entity, normalised by `cash-ledger-history.ts`. A record whose creation was
   * never audited (handovers, legacy rows, fleet records...) gets a synthesised
   * CREATED event (`source: 'RECORD'`) from its own createdAt / creator.
   * 404 when the record is not this vendor's — audit rows are additionally
   * filtered by `vendorId`, so another tenant's history can never leak.
   */
  async getEntryHistory(
    vendorId: string,
    sourceType: string,
    sourceRecordId: string,
  ): Promise<CashLedgerHistoryResponse> {
    const record = await this.loadHistoryRecord(vendorId, sourceType, sourceRecordId);
    if (!record) throw new NotFoundException('Ledger entry not found.');

    const [auditRows, staffAuditRows] = await Promise.all([
      record.audit
        ? this.prisma.auditLog.findMany({
            where: { vendorId, entity: record.audit.entity, entityId: record.audit.entityId },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      record.staffLedgerEntryId
        ? this.prisma.staffLedgerAuditLog.findMany({
            where: { ledgerEntryId: record.staffLedgerEntryId },
            include: { actor: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
    ]);

    // The staff-ledger audit table stores `beforeJson` / `afterJson` / `reason` — same shape once mapped.
    const staffChanges = (row: { beforeJson: unknown; afterJson: unknown; reason: string | null }) => ({
      before: row.beforeJson,
      after: row.afterJson,
      reason: row.reason ?? undefined,
    });

    // One batched lookup each for the vans / people referenced by the diffs (and the actors with no stored name).
    const vanIds = new Set<string>();
    const userIds = new Set<string>();
    const changeBlobs = [...auditRows.map((row) => row.changes), ...staffAuditRows.map(staffChanges)];
    for (const blob of changeBlobs) {
      const ids = collectReferencedIds(blob);
      ids.vanIds.forEach((id) => vanIds.add(id));
      ids.userIds.forEach((id) => userIds.add(id));
    }
    for (const row of auditRows) {
      if (!row.userName && row.userId) userIds.add(row.userId);
    }
    const [vans, users] = await Promise.all([
      vanIds.size
        ? this.prisma.van.findMany({
            where: { id: { in: [...vanIds] }, vendorId },
            select: { id: true, plateNumber: true },
          })
        : Promise.resolve([] as Array<{ id: string; plateNumber: string }>),
      userIds.size
        ? this.prisma.user.findMany({
            where: { id: { in: [...userIds] }, vendorId },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
    ]);
    const resolvers: HistoryResolvers = {
      vans: new Map(vans.map((van) => [van.id, van.plateNumber])),
      users: new Map(users.map((user) => [user.id, user.name])),
    };

    const events: CashLedgerHistoryEvent[] = [
      ...auditRows.map((row) =>
        buildHistoryEvent(
          {
            id: row.id,
            rawAction: row.action,
            at: row.createdAt,
            actorName: row.userName ?? (row.userId ? (resolvers.users.get(row.userId) ?? null) : null),
            changes: row.changes,
            source: 'AUDIT_LOG',
          },
          resolvers,
        ),
      ),
      ...staffAuditRows.map((row) =>
        buildHistoryEvent(
          {
            id: row.id,
            rawAction: row.action,
            at: row.createdAt,
            actorName: row.actor?.name ?? null,
            changes: staffChanges(row),
            source: 'STAFF_LEDGER_AUDIT',
          },
          resolvers,
        ),
      ),
    ];

    if (!events.some((event) => event.action === 'CREATED')) {
      events.push(
        buildRecordCreatedEvent({
          id: `${sourceType}:${record.header.sourceRecordId}`,
          at: new Date(record.header.createdAt),
          actorName: record.header.recordedByName,
          label: record.createdLabel,
        }),
      );
    }

    return { entry: record.header, events: sortHistoryEvents(events) };
  }

  /**
   * Resolves the header (+ which audit entity to read) for a ledger entry, by the
   * `sourceType` the timeline rows carry. Every lookup is vendor-scoped; `null`
   * means "not this vendor's / unknown type" (-> 404).
   */
  private async loadHistoryRecord(
    vendorId: string,
    sourceType: string,
    id: string,
  ): Promise<{
    header: CashLedgerHistoryResponse['entry'];
    audit: { entity: string; entityId: string } | null;
    staffLedgerEntryId?: string;
    createdLabel?: string;
  } | null> {
    const header = (
      title: string,
      amount: number,
      date: Date,
      createdAt: Date,
      recordedByName: string | null,
      status: string | null,
      isVoided: boolean,
    ): CashLedgerHistoryResponse['entry'] => ({
      sourceType,
      sourceRecordId: id,
      title,
      amount: Math.abs(amount),
      date: date.toISOString(),
      createdAt: createdAt.toISOString(),
      recordedByName,
      status,
      isVoided,
    });

    switch (sourceType) {
      case 'OPENING_BALANCE': {
        const r = await this.prisma.vanCashOpeningBalance.findFirst({
          where: { id, vendorId },
          include: { setBy: { select: { name: true } } },
        });
        if (!r) return null;
        return {
          header: header(
            r.note?.trim() || (r.vanId ? 'Opening Balance' : 'Manual Cash In'),
            r.openingBalance,
            r.openingDate,
            r.createdAt,
            r.setBy?.name ?? null,
            r.status,
            r.status === ManualCashInStatus.VOIDED,
          ),
          audit: { entity: 'VanCashOpeningBalance', entityId: r.id },
        };
      }
      case 'VAN_CASH_HANDOVER': {
        const r = await this.prisma.vanCashHandover.findFirst({
          where: { id, vendorId },
          include: { submittedBy: { select: { name: true } } },
        });
        if (!r) return null;
        const sheet = `Daily Sheet #${shortSheetId(r.dailySheetId)}`;
        return {
          header: header(
            r.correctsEntryId ? `Cash handover correction — ${sheet}` : `Cash handover — ${sheet}`,
            r.amount,
            r.date,
            r.createdAt,
            r.submittedBy?.name ?? null,
            r.status,
            r.status === VanCashHandoverStatus.VOIDED,
          ),
          audit: { entity: 'VanCashHandover', entityId: r.id },
          createdLabel: r.correctsEntryId ? 'Correction entry created' : 'Sheet closed',
        };
      }
      case 'OFFICE_CASH_REMITTANCE': {
        const r = await this.prisma.officeCashRemittance.findFirst({
          where: { id, vendorId },
          include: { submittedBy: { select: { name: true } } },
        });
        if (!r) return null;
        const label = VanCashLedgerService.destinationLabel(r.destination, r.destinationName);
        return {
          header: header(
            r.correctsEntryId ? `Handover to ${label} — correction` : `Handover to ${label}`,
            r.amount,
            r.date,
            r.createdAt,
            r.submittedBy?.name ?? null,
            r.status,
            r.status === OfficeCashRemittanceStatus.VOIDED,
          ),
          audit: { entity: 'OfficeCashRemittance', entityId: r.id },
        };
      }
      case 'FUEL_CARD_TOPUP': {
        const r = await this.prisma.fuelCardTopUp.findFirst({
          where: { id, vendorId },
          include: { fuelCard: { select: { name: true } }, createdBy: { select: { name: true } } },
        });
        if (!r) return null;
        return {
          header: header(
            `Fuel card top-up — ${r.fuelCard?.name ?? 'Fuel Card'}`,
            r.amount,
            r.date,
            r.createdAt,
            r.createdBy?.name ?? null,
            r.status,
            r.status === FuelCardTopUpStatus.VOIDED,
          ),
          audit: { entity: 'FuelCardTopUp', entityId: r.id },
        };
      }
      case 'STANDALONE_CREW_CASH': {
        const r = await this.prisma.standaloneCrewCashExpense.findFirst({
          where: { id, vendorId },
          include: { employee: { select: { name: true } }, createdBy: { select: { name: true } } },
        });
        if (!r) return null;
        return {
          header: header(
            `Crew Cash — ${r.employee?.name ?? 'Employee'}`,
            r.amount,
            r.date,
            r.createdAt,
            r.createdBy?.name ?? null,
            r.status,
            r.status === StandaloneCrewCashStatus.VOIDED,
          ),
          audit: { entity: 'StandaloneCrewCashExpense', entityId: r.id },
        };
      }
      case 'EXPENSE': {
        const r = await this.prisma.expense.findFirst({
          where: { id, vendorId },
          include: { createdBy: { select: { name: true } } },
        });
        if (!r) return null;
        return {
          header: header(r.description, r.amount, r.date, r.createdAt, r.createdBy?.name ?? null, null, false),
          audit: { entity: 'Expense', entityId: r.id },
        };
      }
      case 'FUEL_LOG': {
        const r = await this.prisma.fuelLog.findFirst({
          where: { id, vendorId },
          include: { recordedBy: { select: { name: true } } },
        });
        if (!r) return null;
        return {
          header: header(
            r.fuelStation ? `Fuel — ${r.fuelStation}` : 'Fuel fill',
            r.amountPaid,
            r.date,
            r.createdAt,
            r.recordedBy?.name ?? null,
            null,
            false,
          ),
          // A fuel fill's money edits are audited on its linked Expense.
          audit: r.expenseId ? { entity: 'Expense', entityId: r.expenseId } : null,
        };
      }
      case 'VEHICLE_SERVICE': {
        const r = await this.prisma.vehicleServiceRecord.findFirst({
          where: { id, vendorId },
          include: { recordedBy: { select: { name: true } } },
        });
        if (!r) return null;
        return {
          header: header(
            `Vehicle service — ${r.serviceType}`,
            r.cost,
            r.performedAtDate,
            r.createdAt,
            r.recordedBy?.name ?? null,
            null,
            false,
          ),
          audit: { entity: 'VehicleServiceRecord', entityId: r.id },
        };
      }
      case 'STAFF_LEDGER': {
        const r = await this.prisma.staffLedgerEntry.findFirst({
          where: { id, vendorId },
          include: { createdBy: { select: { name: true } }, user: { select: { name: true } } },
        });
        if (!r) return null;
        return {
          header: header(
            r.description?.trim() || `${r.category} — ${r.user?.name ?? 'Employee'}`,
            r.amount,
            r.effectiveDate,
            r.createdAt,
            r.createdBy?.name ?? null,
            r.status,
            r.status === LedgerEntryStatus.VOIDED,
          ),
          audit: null,
          staffLedgerEntryId: r.id,
        };
      }
      case 'SETTLEMENT': {
        const r = await this.prisma.settlement.findFirst({
          where: { id, vendorId },
          include: {
            paidBy: { select: { name: true } },
            payrollEntry: { select: { user: { select: { name: true } } } },
          },
        });
        if (!r) return null;
        return {
          header: header(
            `Salary paid in cash — ${r.payrollEntry?.user?.name ?? 'Employee'}`,
            r.amount,
            r.paidAt,
            r.createdAt,
            r.paidBy?.name ?? null,
            null,
            false,
          ),
          audit: null,
        };
      }
      case 'CREW_CASH': {
        const r = await this.prisma.crewCashDistribution.findFirst({
          where: { id, vendorId },
          include: { employee: { select: { name: true } }, distributedBy: { select: { name: true } } },
        });
        if (!r) return null;
        return {
          header: header(
            `Crew Cash — ${r.employee?.name ?? 'Employee'}`,
            r.amount,
            r.date,
            r.createdAt,
            r.distributedBy?.name ?? null,
            null,
            false,
          ),
          audit: null,
        };
      }
      default:
        return null;
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  /**
   * The single aggregate definition of every bucket over a date window —
   * stats, brought-forward and the live available balance ALL read through it
   * (with `sourceWhere` shared with the timeline's row queries), so they can
   * never disagree with each other or with the row fold.
   *
   * Van-scoped (`vanId` given): only van-anchored sources — handovers, manual
   * entries carrying that vanId, and that van's direct cash expenses. Payroll
   * cash, owner remittances, fuel-card top-ups and standalone crew cash are
   * vendor-wide and contribute 0.
   */
  private async aggregateBuckets(vendorId: string, vanId: string | undefined, range?: DateRange): Promise<BucketTotals> {
    const [
      handoverAgg,
      manualAgg,
      expenseAgg,
      advanceAgg,
      settlementAgg,
      remittanceAgg,
      fuelCardAgg,
      crewCashAgg,
    ] = await Promise.all([
      this.prisma.vanCashHandover.aggregate({
        where: sourceWhere.handover(vendorId, vanId, range),
        _sum: { amount: true },
      }),
      this.prisma.vanCashOpeningBalance.aggregate({
        where: sourceWhere.manualCashIn(vendorId, vanId, [ManualCashInStatus.ACTIVE], range),
        _sum: { openingBalance: true },
      }),
      this.prisma.expense.aggregate({
        where: sourceWhere.officeExpense(vendorId, vanId, range),
        _sum: { amount: true },
      }),
      vanId
        ? null
        : this.prisma.staffLedgerEntry.aggregate({
            where: sourceWhere.payrollAdvance(vendorId, range),
            _sum: { amount: true },
          }),
      vanId
        ? null
        : this.prisma.settlement.aggregate({
            where: sourceWhere.cashSettlement(vendorId, range),
            _sum: { amount: true },
          }),
      vanId
        ? null
        : this.prisma.officeCashRemittance.aggregate({
            where: sourceWhere.remittance(vendorId, [OfficeCashRemittanceStatus.APPROVED], range),
            _sum: { amount: true },
          }),
      vanId
        ? null
        : this.prisma.fuelCardTopUp.aggregate({
            where: sourceWhere.fuelCardTopUp(vendorId, [FuelCardTopUpStatus.ACTIVE], range),
            _sum: { amount: true },
          }),
      vanId
        ? null
        : this.prisma.standaloneCrewCashExpense.aggregate({
            where: sourceWhere.standaloneCrewCash(vendorId, [StandaloneCrewCashStatus.ACTIVE], range),
            _sum: { amount: true },
          }),
    ]);

    const totals = emptyBucketTotals();
    totals.sheetCashIn = handoverAgg._sum.amount ?? 0;
    totals.officeCashIn = manualAgg._sum.openingBalance ?? 0;
    totals.officeExpenses = expenseAgg._sum.amount ?? 0;
    // ADVANCE debits are stored negative (the where clause guarantees amount < 0);
    // the ledger reports the cash-out magnitude.
    totals.payrollCash = Math.abs(advanceAgg?._sum.amount ?? 0) + (settlementAgg?._sum.amount ?? 0);
    totals.ownerTransfer = remittanceAgg?._sum.amount ?? 0;
    totals.fuelCard = fuelCardAgg?._sum.amount ?? 0;
    totals.crewCash = crewCashAgg?._sum.amount ?? 0;
    return totals;
  }

  /** Signed net of EVERYTHING dated before `from` — the balance the in-window running fold starts from. */
  private async computeBroughtForward(vendorId: string, vanId: string | undefined, from: Date): Promise<number> {
    const before = await this.aggregateBuckets(vendorId, vanId, { lt: from });
    return summarizeTotals(before, 0).net;
  }

  /**
   * The true current balance — every source, all time, ignoring any
   * `from`/`to` filter (only `vanId`, when given, narrows it). It is
   * `aggregateBuckets` over the unbounded window, i.e. the very same
   * definition the timeline and the period stats use.
   *
   * Office->owner remittances, fuel-card top-ups, crew cash and payroll cash
   * are vendor-wide: they leave the shared office pool, not any one van's
   * cash-in-hand, so a van-scoped balance must not count them.
   */
  private async computeAvailableBalance(vendorId: string, vanId?: string): Promise<number> {
    const all = await this.aggregateBuckets(vendorId, vanId, undefined);
    return summarizeTotals(all, 0).net;
  }

  /**
   * Manual cash-in rows for the timeline, in the SAME window as every other
   * source (previously they were filtered by `to` only, which pulled every
   * pre-`from` manual entry into the window while the other sources were
   * excluded). Each entry is its own row — repeatable, dated at its own
   * `openingDate` and titled from its `note` when one was given. Per-van view:
   * only that van's own entries. Vendor-wide view: every entry, van-anchored or
   * general alike, so a van-scoped balance never counts a general entry (same
   * treatment OfficeCashRemittance / FuelCardTopUp already get).
   */
  private async buildOpeningBalanceRows(
    vendorId: string,
    vanId: string | undefined,
    range: DateRange | undefined,
  ): Promise<VanCashLedgerRow[]> {
    const rows = await this.prisma.vanCashOpeningBalance.findMany({
      where: sourceWhere.manualCashIn(
        vendorId,
        vanId,
        [ManualCashInStatus.ACTIVE, ManualCashInStatus.VOIDED],
        range,
      ),
      include: {
        van: { select: { plateNumber: true } },
        setBy: { select: { name: true } },
        voidedBy: { select: { name: true } },
      },
      orderBy: { openingDate: 'asc' },
    });

    return rows.map((row) => {
      const badge = row.vanId ? 'Opening Balance' : 'Manual Cash In';
      const date = row.openingDate.toISOString();
      const isVoided = row.status === ManualCashInStatus.VOIDED;
      return {
        ...rowV2('OFFICE_CASH_IN', row.createdAt, date, {
          recordedByName: row.setBy?.name ?? null,
          recordedById: row.setById ?? null,
          notes: row.note?.trim() || null,
          isEdited: row.editCount > 0,
          lastEditedAt: row.editCount > 0 ? (row.lastEditedAt?.toISOString() ?? null) : null,
          voidedAt: isVoided ? (row.voidedAt?.toISOString() ?? null) : null,
          voidedByName: isVoided ? (row.voidedBy?.name ?? null) : null,
          source: (row.source as ManualCashInSource | null) ?? null,
        }),
        id: `OPENING_BALANCE:${row.id}`,
        date,
        createdAt: row.createdAt.toISOString(),
        bucket: 'OFFICE_CASH_IN' as const,
        type: 'OPENING_BALANCE' as const,
        // A voided entry is shown for the audit trail but must not move the
        // running balance — it folds in as 0 (same as a voided remittance).
        amount: isVoided ? 0 : row.openingBalance,
        displayAmount: Math.abs(row.openingBalance),
        runningBalance: 0,
        title: row.note?.trim() || badge,
        vanId: row.vanId,
        vanPlateNumber: row.van?.plateNumber ?? null,
        sourceType: 'OPENING_BALANCE',
        sourceRecordId: row.id,
        sourceBadge: manualCashInSourceLabel(row.source) ?? badge,
        status: null,
        dailySheetId: null,
        submittedByName: null,
        approvedByName: null,
        version: row.version,
        isVoided,
        voidReason: isVoided ? (row.voidReason ?? null) : null,
      };
    });
  }

  private normalizeCashIn(
    row: VanCashHandover & { van: { plateNumber: string }; submittedBy: { name: string } | null; approvedBy: { name: string } | null },
  ): VanCashLedgerRow {
    const isCorrection = row.correctsEntryId !== null;
    const badge = `via Daily Sheet #${shortSheetId(row.dailySheetId)}`;
    // P4: a posting redirected out of a CLOSED period counts on `date` (current
    // period) but is "for" its original business day.
    const relatesToDate = row.relatesToDate ?? null;
    const title =
      (isCorrection
        ? `Cash handover correction — Daily Sheet #${shortSheetId(row.dailySheetId)}`
        : `Cash handover — Daily Sheet #${shortSheetId(row.dailySheetId)}`) +
      (relatesToDate ? ` — for ${shortDayLabel(relatesToDate)}` : '');
    const date = row.date.toISOString();
    return {
      ...rowV2('SHEET_CASH_IN', row.createdAt, date, {
        relatesToDate: relatesToDate ? relatesToDate.toISOString() : null,
        recordedByName: row.submittedBy?.name ?? null,
        recordedById: row.submittedById ?? null,
        approvedById: row.approvedById ?? null,
        expectedAmount: row.expectedAmount ?? null,
        variance: round2(row.amount - (row.expectedAmount ?? row.amount)),
      }),
      id: `${isCorrection ? 'CASH_IN_CORRECTION' : 'CASH_IN'}:${row.id}`,
      date,
      createdAt: row.createdAt.toISOString(),
      bucket: 'SHEET_CASH_IN',
      type: isCorrection ? 'CASH_IN_CORRECTION' : 'CASH_IN',
      // The FINAL approved amount (R5), signed — a downward correction can
      // legitimately be negative even though its type is still "cash in
      // family" (see interface doc).
      amount: row.amount,
      displayAmount: Math.abs(row.amount),
      runningBalance: 0,
      title,
      vanId: row.vanId,
      vanPlateNumber: row.van.plateNumber,
      sourceType: 'VAN_CASH_HANDOVER',
      sourceRecordId: row.id,
      sourceBadge: badge,
      status: row.status,
      dailySheetId: row.dailySheetId,
      submittedByName: row.submittedBy?.name ?? null,
      approvedByName: row.approvedBy?.name ?? null,
      version: row.version,
    };
  }

  private normalizeCashOut(
    row: ExpenseCenterRow,
    createdAt: Date,
    bucket: CashLedgerBucket,
    v2: Partial<CashLedgerRowV2> = {},
  ): VanCashLedgerRow {
    return {
      ...rowV2(bucket, createdAt, row.date, { recordedByName: row.recordedByName, ...v2 }),
      id: `CASH_OUT:${row.id}`,
      date: row.date,
      createdAt: createdAt.toISOString(),
      bucket,
      type: 'CASH_OUT',
      amount: -row.amount,
      displayAmount: row.amount,
      runningBalance: 0,
      title: row.title,
      // ExpenseCenterRow carries no raw vanId/dailySheetId today — plateNumber
      // (already present) covers display, and van-scoping already happened
      // server-side via the query filter, so this is a display-only gap, not
      // a functional one. Revisit if ExpenseCenterRow ever exposes vanId.
      vanId: null,
      vanPlateNumber: row.vanPlateNumber,
      sourceType: row.sourceType,
      sourceRecordId: row.sourceRecordId,
      sourceBadge: row.sourceBadge,
      status: null,
      dailySheetId: null,
      submittedByName: row.recordedByName,
      approvedByName: null,
      version: null,
      domain: row.domain,
      category: row.category,
      categoryLabel: row.categoryLabel,
      costSign: row.costSign,
      paidFromCash: row.paidFromCash,
      employeeName: row.employeeName,
      locked: row.locked,
      lockedReason: row.lockedReason,
    };
  }

  /**
   * A CASH payroll settlement (R6) — salary physically paid out of office cash.
   * Its own row type (not CASH_OUT) because it has no Expense Center detail
   * drawer to route to; `sourceRecordId` is the Settlement id.
   */
  private normalizeSettlementOut(row: {
    id: string;
    amount: number;
    paidAt: Date;
    createdAt: Date;
    payrollEntry: { user: { id?: string; name: string } | null } | null;
    paidById?: string | null;
    paidBy: { name: string } | null;
  }): VanCashLedgerRow {
    const employeeName = row.payrollEntry?.user?.name ?? 'Employee';
    const date = row.paidAt.toISOString();
    return {
      ...rowV2('PAYROLL_CASH', row.createdAt, date, {
        recordedByName: row.paidBy?.name ?? null,
        recordedById: row.paidById ?? null,
        employeeId: row.payrollEntry?.user?.id ?? null,
      }),
      id: `PAYROLL_SETTLEMENT_OUT:${row.id}`,
      date,
      createdAt: row.createdAt.toISOString(),
      bucket: 'PAYROLL_CASH',
      type: 'PAYROLL_SETTLEMENT_OUT',
      amount: -row.amount,
      displayAmount: Math.abs(row.amount),
      runningBalance: 0,
      title: `Salary paid in cash — ${employeeName}`,
      vanId: null,
      vanPlateNumber: null,
      sourceType: 'SETTLEMENT',
      sourceRecordId: row.id,
      sourceBadge: 'via Payroll',
      status: null,
      dailySheetId: null,
      submittedByName: row.paidBy?.name ?? null,
      approvedByName: null,
      version: null,
      employeeName,
    };
  }

  /** Human label for a remittance's destination, folding in the free-text name where relevant. */
  private static destinationLabel(
    destination: OfficeCashRemittanceDestination,
    destinationName: string | null,
  ): string {
    switch (destination) {
      case OfficeCashRemittanceDestination.OWNER:
        return destinationName ? `Owner (${destinationName})` : 'Owner';
      case OfficeCashRemittanceDestination.CEO:
        return destinationName ? `CEO (${destinationName})` : 'CEO';
      case OfficeCashRemittanceDestination.BANK:
        return destinationName ? `Bank (${destinationName})` : 'Bank';
      default:
        return destinationName ?? 'Other';
    }
  }

  private normalizeRemittanceOut(
    row: OfficeCashRemittance & {
      submittedBy: { name: string } | null;
      approvedBy: { name: string } | null;
      voidedBy: { name: string } | null;
    },
  ): VanCashLedgerRow {
    const isVoided = row.status === OfficeCashRemittanceStatus.VOIDED;
    const isCorrection = row.correctsEntryId !== null;
    const label = VanCashLedgerService.destinationLabel(row.destination, row.destinationName);
    const date = row.date.toISOString();
    return {
      ...rowV2('OWNER_TRANSFER', row.createdAt, date, {
        recordedByName: row.submittedBy?.name ?? null,
        recordedById: row.submittedById ?? null,
        approvedById: row.approvedById ?? null,
        destination: row.destination ?? null,
        notes: row.note ?? null,
        reference: row.reference ?? null,
        hasAttachment: !!row.attachmentKey,
        voidedAt: isVoided ? (row.voidedAt?.toISOString() ?? null) : null,
        voidedByName: isVoided ? (row.voidedBy?.name ?? null) : null,
      }),
      id: `CASH_REMITTANCE_OUT:${row.id}`,
      date,
      createdAt: row.createdAt.toISOString(),
      bucket: 'OWNER_TRANSFER',
      type: 'CASH_REMITTANCE_OUT',
      // A voided remittance is shown for the audit trail but must not move the
      // running balance — it folds in as 0. A correction row carries its own
      // signed DELTA (which may be negative for a downward adjustment).
      amount: isVoided ? 0 : -row.amount,
      displayAmount: Math.abs(row.amount),
      runningBalance: 0,
      title: isCorrection ? `Handover to ${label} — correction` : `Handover to ${label}`,
      vanId: null,
      vanPlateNumber: null,
      sourceType: 'OFFICE_CASH_REMITTANCE',
      sourceRecordId: row.id,
      sourceBadge: row.reference ? `Ref ${row.reference}` : label,
      status: null,
      dailySheetId: null,
      submittedByName: row.submittedBy?.name ?? null,
      approvedByName: row.approvedBy?.name ?? null,
      version: row.version,
      isVoided,
      voidReason: row.voidReason ?? null,
      isCorrection,
    };
  }

  private normalizeFuelCardTopUpOut(
    row: FuelCardTopUp & {
      fuelCard: { name: string } | null;
      createdBy: { name: string } | null;
      voidedBy: { name: string } | null;
    },
  ): VanCashLedgerRow {
    const isVoided = row.status === FuelCardTopUpStatus.VOIDED;
    const cardName = row.fuelCard?.name ?? 'Fuel Card';
    const date = row.date.toISOString();
    return {
      ...rowV2('FUEL_CARD', row.createdAt, date, {
        recordedByName: row.createdBy?.name ?? null,
        recordedById: row.createdById ?? null,
        notes: row.note ?? null,
        reference: row.reference ?? null,
        hasAttachment: !!row.attachmentKey,
        voidedAt: isVoided ? (row.voidedAt?.toISOString() ?? null) : null,
        voidedByName: isVoided ? (row.voidedBy?.name ?? null) : null,
      }),
      id: `FUEL_CARD_TOPUP_OUT:${row.id}`,
      date,
      createdAt: row.createdAt.toISOString(),
      bucket: 'FUEL_CARD',
      type: 'FUEL_CARD_TOPUP_OUT',
      // A voided top-up is shown for the audit trail but must not move the
      // running balance — it folds in as 0.
      amount: isVoided ? 0 : -row.amount,
      displayAmount: Math.abs(row.amount),
      runningBalance: 0,
      title: `Fuel card top-up — ${cardName}`,
      vanId: null,
      vanPlateNumber: null,
      sourceType: 'FUEL_CARD_TOPUP',
      sourceRecordId: row.id,
      sourceBadge: row.reference ? `Ref ${row.reference}` : cardName,
      status: null,
      dailySheetId: null,
      submittedByName: row.createdBy?.name ?? null,
      approvedByName: null,
      version: null,
      isVoided,
      voidReason: row.voidReason ?? null,
    };
  }

  private normalizeStandaloneCrewCashOut(
    row: StandaloneCrewCashExpense & {
      employee: { name: string } | null;
      createdBy: { name: string } | null;
      voidedBy: { name: string } | null;
      staffLedgerEntry?: { payrollEntryId: string | null; status?: LedgerEntryStatus } | null;
    },
  ): VanCashLedgerRow {
    const isVoided = row.status === StandaloneCrewCashStatus.VOIDED;
    const employeeName = row.employee?.name ?? 'Employee';
    const date = row.date.toISOString();
    const edited = row.editCount > 0;
    const built: VanCashLedgerRow = {
      ...rowV2('CREW_CASH', row.createdAt, date, {
        recordedByName: row.createdBy?.name ?? null,
        recordedById: row.createdById ?? null,
        notes: row.notes ?? null,
        employeeId: row.employeeId ?? null,
        isEdited: edited,
        lastEditedAt: edited ? (row.lastEditedAt?.toISOString() ?? null) : null,
        voidedAt: isVoided ? (row.voidedAt?.toISOString() ?? null) : null,
        voidedByName: isVoided ? (row.voidedBy?.name ?? null) : null,
      }),
      id: `STANDALONE_CREW_CASH_OUT:${row.id}`,
      date,
      createdAt: row.createdAt.toISOString(),
      bucket: 'CREW_CASH',
      type: 'STANDALONE_CREW_CASH_OUT',
      // A voided entry is shown for the audit trail but must not move the
      // running balance — it folds in as 0.
      amount: isVoided ? 0 : -row.amount,
      displayAmount: Math.abs(row.amount),
      runningBalance: 0,
      title: `Crew Cash — ${employeeName}`,
      vanId: null,
      vanPlateNumber: null,
      sourceType: 'STANDALONE_CREW_CASH',
      sourceRecordId: row.id,
      sourceBadge: row.category,
      status: null,
      dailySheetId: null,
      submittedByName: row.createdBy?.name ?? null,
      approvedByName: null,
      version: row.version,
      isVoided,
      voidReason: row.voidReason ?? null,
      category: row.category,
      employeeName,
    };
    if (!isVoided && isStandaloneCrewCashTwinLocked(row.staffLedgerEntry)) TWIN_LOCKED_ROWS.add(built);
    return built;
  }

  /**
   * Loads the full logical remittance chain (root + every correction) that
   * `anyId` belongs to, in creation order. Corrections form a linear chain —
   * each points at the previous tip via `correctsEntryId` — so this walks up
   * to the root and then down through the descendants. Volume is tiny (a
   * handful of rows per logical remittance at most), the same trade-off the
   * class-level getTimeline doc calls out.
   */
  private async loadRemittanceChain(
    tx: Prisma.TransactionClient,
    vendorId: string,
    anyId: string,
  ): Promise<OfficeCashRemittance[]> {
    let cursor = await tx.officeCashRemittance.findFirst({ where: { id: anyId, vendorId } });
    if (!cursor) return [];

    // Walk up to the root.
    while (cursor.correctsEntryId) {
      const parent = await tx.officeCashRemittance.findFirst({
        where: { id: cursor.correctsEntryId, vendorId },
      });
      if (!parent) break;
      cursor = parent;
    }

    // Walk down through the (linear) descendant chain.
    const chain: OfficeCashRemittance[] = [cursor];
    let tip = cursor;
    for (;;) {
      const child = await tx.officeCashRemittance.findFirst({
        where: { correctsEntryId: tip.id, vendorId },
        orderBy: { createdAt: 'asc' },
      });
      if (!child) break;
      chain.push(child);
      tip = child;
    }
    return chain;
  }
}
