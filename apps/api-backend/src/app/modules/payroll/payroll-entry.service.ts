import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  AdvanceInstallmentStatus,
  AttendanceStatus,
  LedgerEntryStatus,
  PayFrequency,
  PayrollAuditAction,
  PayrollEntryStatus,
  PayrollPeriod,
  PayrollPeriodStatus,
  Prisma,
  StaffLedgerCategory,
  UserRole,
} from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { assertCanViewEmployeePayroll } from '../../common/helpers/payroll-view-scope.util';
import { roundToNearestRupee } from '../../common/helpers/payroll-rounding.util';
import { PermissionService } from '../authz/permission.service';
import { StaffAdvancePlanService } from './staff-advance-plan.service';
import { computeCycleForCutoff } from './payroll-cycle.util';

function versionMismatch(expected: number, received: number): ConflictException {
  return new ConflictException(`Version mismatch: expected ${expected}, received ${received}. Reload and retry.`);
}

/**
 * Roles that receive a PayrollEntry when a period's draft is generated.
 * Exported so `StaffAttendanceService.markStatus` can reject attendance
 * marked against a non-payroll-eligible account (merge-review finding N1).
 */
export const PAYROLL_ELIGIBLE_ROLES: UserRole[] = [
  UserRole.STAFF,
  UserRole.DRIVER,
  UserRole.SALESMAN,
  UserRole.LOADER,
];

/** The seven PayrollEntry bucket columns, keyed the same as the schema. */
type BucketTotals = {
  bonuses: number;
  overtime: number;
  incentives: number;
  advances: number;
  expenses: number;
  penalties: number;
  otherDeductions: number;
};

function emptyBuckets(): BucketTotals {
  return { bonuses: 0, overtime: 0, incentives: 0, advances: 0, expenses: 0, penalties: 0, otherDeductions: 0 };
}

/**
 * Maps a StaffLedgerCategory to the single PayrollEntry bucket column its
 * (already-signed) amount is summed into. PENALTY has its own dedicated
 * `penalties` column; DEDUCTION/LEAVE_UNPAID/LEAVE_PAID/ADJUSTMENT/REVERSAL/
 * CORRECTION all fold into the general-purpose `otherDeductions` column
 * (there is no dedicated column for each of those). REVERSAL/CORRECTION rows
 * are summed by their own category field exactly like any other row — see
 * StaffLedgerService.reverse()/correct(), which always write
 * category=REVERSAL / category=CORRECTION on the new row regardless of what
 * the original entry being reversed/corrected was.
 */
function bucketKeyForCategory(category: StaffLedgerCategory): keyof BucketTotals {
  switch (category) {
    case StaffLedgerCategory.ADVANCE:
      return 'advances';
    case StaffLedgerCategory.EXPENSE_REIMBURSEMENT:
      return 'expenses';
    case StaffLedgerCategory.BONUS:
      return 'bonuses';
    case StaffLedgerCategory.INCENTIVE:
      return 'incentives';
    case StaffLedgerCategory.OVERTIME:
      return 'overtime';
    case StaffLedgerCategory.PENALTY:
      return 'penalties';
    case StaffLedgerCategory.DEDUCTION:
    case StaffLedgerCategory.LEAVE_UNPAID:
    case StaffLedgerCategory.LEAVE_PAID:
    case StaffLedgerCategory.ADJUSTMENT:
    case StaffLedgerCategory.REVERSAL:
    case StaffLedgerCategory.CORRECTION:
    // Crew Cash Distribution sync (docs/features/crew-operational-cash-distribution.md
    // §7) — a labeling choice, not an engine change: folds into the same
    // catch-all bucket as DEDUCTION/ADJUSTMENT rather than a dedicated column.
    case StaffLedgerCategory.CREW_CASH:
      return 'otherDeductions';
    // Advance Installments (2026-09-24) — ADVANCE_RECOVERY is one period's
    // collected installment against a StaffAdvancePlan; same economic meaning
    // as a plain ADVANCE (money owed back), so it folds into the same column.
    case StaffLedgerCategory.ADVANCE_RECOVERY:
      return 'advances';
    // ADVANCE_DISBURSEMENT must never reach here — computeLedgerContribution's
    // query filter excludes it entirely (a loan disbursement is not itself a
    // payroll deduction; only its ADVANCE_RECOVERY installments are). This
    // throw only catches a future regression where that filter is removed
    // without updating this function too.
    case StaffLedgerCategory.ADVANCE_DISBURSEMENT:
      throw new Error(
        'ADVANCE_DISBURSEMENT must never reach bucketKeyForCategory — check computeLedgerContribution\'s query filter.',
      );
  }
}

interface SkippedMissingSalaryStructure {
  userId: string;
  name: string;
}

interface SkippedDataError {
  userId: string;
  name: string;
  reason: string;
}

interface SkippedAlreadyReviewed {
  userId: string;
  name: string;
  status: PayrollEntryStatus;
}

/**
 * Pre-aggregated PRESENT / HALF_DAY StaffAttendance counts for one employee
 * within a period (Staff Attendance & Wage Types Phase 3, §4). Feeds
 * `resolvePeriodBase()` for a DAILY/WEEKLY employee only — a MONTHLY
 * employee's base never reads this.
 */
interface AttendanceAggregate {
  presentDays: number;
  halfDays: number;
}

/**
 * The payroll calculation engine (§ schema module note, PayrollEntry).
 *
 * `finalPayable` is always a single flat sum — `baseSalary + every bucket +
 * carryForwardIn` — never a subtraction expression. Every StaffLedgerEntry
 * bucket total is the raw signed sum of already-correctly-signed
 * `StaffLedgerEntry.amount` values for that category (ADVANCE/PENALTY/
 * DEDUCTION/LEAVE_UNPAID are negative, BONUS/INCENTIVE/OVERTIME/
 * EXPENSE_REIMBURSEMENT/LEAVE_PAID are positive at creation time — see
 * StaffLedgerService). Summing them flatly into `finalPayable` is therefore
 * always correct; sign-flipping any bucket (e.g. subtracting `expenses`)
 * would double-charge debits and turn reimbursements into deductions.
 */
@Injectable()
export class PayrollEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly advancePlans: StaffAdvancePlanService,
  ) {}

  /**
   * Computes and upserts a PayrollEntry per payroll-eligible active employee
   * in the vendor. Only allowed while the period is OPEN or REVIEW. An entry
   * already past DRAFT (UNDER_REVIEW/APPROVED/LOCKED/SETTLED) is left
   * untouched on regeneration — reported back as skippedAlreadyReviewed
   * rather than silently overwritten.
   */
  async generateDraft(user: AuthUser, periodId: string) {
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id: periodId, vendorId: user.vendorId } });
    if (!period) throw new NotFoundException('Payroll period not found.');
    if (period.status === PayrollPeriodStatus.LOCKED || period.status === PayrollPeriodStatus.PAID) {
      throw new BadRequestException(`Cannot generate payroll entries for a ${period.status} period.`);
    }

    const eligibleEmployees = await this.prisma.user.findMany({
      where: { vendorId: user.vendorId, isActive: true, role: { in: PAYROLL_ELIGIBLE_ROLES } },
      select: { id: true, name: true },
    });

    const generated: string[] = [];
    const regenerated: string[] = [];
    const skippedMissingSalaryStructure: SkippedMissingSalaryStructure[] = [];
    const skippedDataError: SkippedDataError[] = [];
    const skippedAlreadyReviewed: SkippedAlreadyReviewed[] = [];

    await this.prisma.$transaction(async (tx) => {
      // Pre-aggregated ONCE per run, not per employee (§4 Phase 3) — keeps the
      // existing single transaction short. Harmless no-op for a vendor with
      // only MONTHLY employees: resolvePeriodBase() never reads this map for
      // them.
      const attendanceByUser = await this.aggregateAttendance(tx, user.vendorId, period);

      for (const employee of eligibleEmployees) {
        const structures = await tx.salaryStructure.findMany({
          where: {
            vendorId: user.vendorId,
            userId: employee.id,
            voidedAt: null,
            effectiveFrom: { lte: period.endDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.endDate } }],
          },
        });

        if (structures.length === 0) {
          skippedMissingSalaryStructure.push({ userId: employee.id, name: employee.name });
          continue;
        }
        if (structures.length > 1) {
          skippedDataError.push({
            userId: employee.id,
            name: employee.name,
            reason: `${structures.length} overlapping SalaryStructure rows are effective on ${period.endDate
              .toISOString()
              .slice(0, 10)} — data error, resolve before generating this employee's entry.`,
          });
          continue;
        }

        // Merge-review finding H1: a DAILY/WEEKLY employee's base is
        // attendance-derived across the WHOLE period (see resolvePeriodBase /
        // aggregateAttendance below) — it has no notion of "which structure
        // was in force on which day". If a prior SalaryStructure version was
        // still effective for any part of this period before being
        // superseded by the current (non-MONTHLY) one, applying the current
        // rate to the full period's attendance would silently misattribute
        // pay for the days that were actually under the old rate/frequency.
        // MONTHLY is untouched (it already applies one flat rate to the
        // whole period by design — Payroll Doc §5 "simplest, most
        // predictable rule", accepted and documented before this feature).
        if (structures[0].payFrequency !== PayFrequency.MONTHLY) {
          const priorStructure = await tx.salaryStructure.findFirst({
            where: {
              vendorId: user.vendorId,
              userId: employee.id,
              id: { not: structures[0].id },
              voidedAt: null,
              effectiveTo: { gte: period.startDate },
            },
            select: { id: true, payFrequency: true, effectiveTo: true },
          });
          if (priorStructure) {
            skippedDataError.push({
              userId: employee.id,
              name: employee.name,
              reason:
                `Salary structure changed mid-period (from ${priorStructure.payFrequency} to ` +
                `${structures[0].payFrequency}, effective ${structures[0].effectiveFrom.toISOString().slice(0, 10)}) — ` +
                'a DAILY/WEEKLY base cannot span a rate or frequency change within one period. ' +
                'Resolve manually (e.g. settle via the prior period, or a manual ledger Adjustment) before generating this entry.',
            });
            continue;
          }
        }

        const existingEntry = await tx.payrollEntry.findUnique({
          where: { periodId_userId: { periodId, userId: employee.id } },
        });
        if (existingEntry && existingEntry.status !== PayrollEntryStatus.DRAFT) {
          skippedAlreadyReviewed.push({ userId: employee.id, name: employee.name, status: existingEntry.status });
          continue;
        }

        const baseSalary = this.resolvePeriodBase(structures[0], attendanceByUser.get(employee.id));
        const { buckets, carryForwardIn, finalPayable } = await this.computeEntryBreakdown(
          tx,
          user.vendorId,
          employee.id,
          period,
          baseSalary,
        );

        if (existingEntry) {
          const before = {
            baseSalary: existingEntry.baseSalary,
            finalPayable: existingEntry.finalPayable,
          };
          const updated = await tx.payrollEntry.update({
            where: { id: existingEntry.id },
            data: { baseSalary, ...buckets, carryForwardIn, finalPayable, version: { increment: 1 } },
          });
          await tx.payrollEntryAuditLog.create({
            data: {
              payrollEntryId: updated.id,
              actorId: user.userId,
              actorRole: user.role,
              action: PayrollAuditAction.REGENERATED,
              beforeJson: before,
              afterJson: { baseSalary: updated.baseSalary, finalPayable: updated.finalPayable },
            },
          });
          regenerated.push(employee.id);
        } else {
          const created = await tx.payrollEntry.create({
            data: {
              periodId,
              userId: employee.id,
              vendorId: user.vendorId,
              baseSalary,
              ...buckets,
              carryForwardIn,
              finalPayable,
              status: PayrollEntryStatus.DRAFT,
            },
          });
          await tx.payrollEntryAuditLog.create({
            data: {
              payrollEntryId: created.id,
              actorId: user.userId,
              actorRole: user.role,
              action: PayrollAuditAction.GENERATED,
              afterJson: { baseSalary: created.baseSalary, finalPayable: created.finalPayable },
            },
          });
          generated.push(employee.id);
        }

        // Advance Installments — auto-generate this period's PENDING
        // installment (if any ACTIVE plan is due) alongside the entry itself.
        // Idempotent: a no-op on regeneration once the row already exists.
        await this.advancePlans.ensureInstallmentsForPeriod(tx, user.vendorId, employee.id, periodId);
      }
    });

    return { periodId, generated, regenerated, skippedMissingSalaryStructure, skippedDataError, skippedAlreadyReviewed };
  }

  /** Atomic CAS: DRAFT -> APPROVED. */
  async approveEntry(user: AuthUser, entryId: string, version: number) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.payrollEntry.findFirst({ where: { id: entryId, vendorId: user.vendorId } });
      if (!entry) throw new NotFoundException('Payroll entry not found.');

      if (entry.status !== PayrollEntryStatus.DRAFT) {
        throw new BadRequestException(`Only DRAFT entries can be approved (current status: ${entry.status}).`);
      }

      const claim = await tx.payrollEntry.updateMany({
        where: { id: entryId, vendorId: user.vendorId, version },
        data: {
          status: PayrollEntryStatus.APPROVED,
          approvedById: user.userId,
          approvedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (claim.count === 0) {
        throw versionMismatch(entry.version, version);
      }

      const updated = await tx.payrollEntry.findUniqueOrThrow({ where: { id: entryId } });

      await tx.payrollEntryAuditLog.create({
        data: {
          payrollEntryId: entryId,
          actorId: user.userId,
          actorRole: user.role,
          action: PayrollAuditAction.APPROVED,
          beforeJson: { status: entry.status },
          afterJson: { status: updated.status, approvedById: user.userId },
        },
      });

      return updated;
    });
  }

  /**
   * Full itemized breakdown for one entry — every bucket plus the ledger
   * entries that fed it. Self-view-only unless the requester holds
   * `payroll:view_all` — checked AFTER the fetch, since the entry (looked up
   * by its own id) is the only place its owning `userId` is known.
   */
  async getBreakdown(user: AuthUser, entryId: string) {
    const entry = await this.prisma.payrollEntry.findFirst({
      where: { id: entryId, vendorId: user.vendorId },
      include: { period: true, user: { select: { id: true, name: true, role: true } } },
    });
    if (!entry) throw new NotFoundException('Payroll entry not found.');

    await assertCanViewEmployeePayroll(this.permissions, user, entry.userId);

    const cashWindow = await this.resolveCashWindow(this.prisma, user.vendorId, entry.period);

    const ledgerEntries = await this.prisma.staffLedgerEntry.findMany({
      where: {
        vendorId: user.vendorId,
        userId: entry.userId,
        status: LedgerEntryStatus.POSTED,
        ...this.ledgerWindowFilter(entry.period, cashWindow),
      },
      orderBy: { effectiveDate: 'asc' },
    });

    const byBucket: Record<keyof BucketTotals, typeof ledgerEntries> = {
      bonuses: [],
      overtime: [],
      incentives: [],
      advances: [],
      expenses: [],
      penalties: [],
      otherDeductions: [],
    };
    for (const ledgerEntry of ledgerEntries) {
      // ADVANCE_DISBURSEMENT never claims a bucket (see bucketKeyForCategory) —
      // but it IS fetched here (this query has no category filter, unlike
      // computeLedgerContribution) purely for display in the Advances tab via
      // `advancePlans` below, not grouped into `ledgerEntriesByBucket`.
      if (ledgerEntry.category === StaffLedgerCategory.ADVANCE_DISBURSEMENT) continue;
      byBucket[bucketKeyForCategory(ledgerEntry.category)].push(ledgerEntry);
    }

    const attendance = await this.summarizeAttendance(entry.userId, entry.period);
    const structure = await this.prisma.salaryStructure.findFirst({
      where: {
        vendorId: user.vendorId,
        userId: entry.userId,
        voidedAt: null,
        effectiveFrom: { lte: entry.period.endDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: entry.period.endDate } }],
      },
    });
    const suggestedMonthlyDailyRate =
      structure?.payFrequency === PayFrequency.MONTHLY
        ? this.suggestedMonthlyDailyRate(structure.baseAmount, entry.period)
        : null;
    const advancePlans = await this.advancePlans.listForEmployeePeriod(user.vendorId, entry.userId, entry.periodId);

    return { entry, ledgerEntriesByBucket: byBucket, attendance, suggestedMonthlyDailyRate, advancePlans, cashWindow };
  }

  /**
   * Present/Absent/Half-day/Leave/Weekly-off counts + the raw day list for one
   * employee's period — feeds the Attendance tab on the draft-click breakdown
   * dialog (owner-requested 2026-09-24). Reuses the same date-range shape as
   * `StaffAttendanceService.listByPeriod`, just employee- instead of
   * vendor-scoped, and includes days with NO attendance row at all
   * (`unmarkedDays`) since those are exactly the ones an admin may still want
   * to act on from that screen.
   */
  private async summarizeAttendance(userId: string, period: PayrollPeriod) {
    const rows = await this.prisma.staffAttendance.findMany({
      where: { userId, date: { gte: period.startDate, lte: period.endDate } },
      orderBy: { date: 'asc' },
      include: { category: { select: { id: true, name: true } } },
    });

    const counts = { presentDays: 0, absentDays: 0, halfDays: 0, leaveDays: 0, weeklyOffDays: 0 };
    for (const row of rows) {
      switch (row.status) {
        case AttendanceStatus.PRESENT:
          counts.presentDays++;
          break;
        case AttendanceStatus.ABSENT:
          counts.absentDays++;
          break;
        case AttendanceStatus.HALF_DAY:
          counts.halfDays++;
          break;
        case AttendanceStatus.LEAVE:
          counts.leaveDays++;
          break;
        case AttendanceStatus.WEEKLY_OFF:
          counts.weeklyOffDays++;
          break;
      }
    }

    const periodDayCount = this.periodDayCount(period);
    const unmarkedDays = Math.max(0, periodDayCount - rows.length);

    return {
      ...counts,
      periodDayCount,
      unmarkedDays,
      days: rows.map((row) => ({
        date: row.date,
        status: row.status,
        note: row.note,
        categoryId: row.categoryId,
        categoryName: row.category?.name ?? null,
        hasDeduction: row.leaveLedgerEntryId != null,
      })),
    };
  }

  /**
   * `endDate` is stored at 23:59:59.999 of the last day (see
   * `PayrollPeriodService`'s period-creation helper), not midnight — so the
   * raw ms difference is always just under N whole days, never exactly N.
   * `Math.floor` (not `round`) is required here: rounding a value like
   * 30.999999988 up to 31 before the `+1` would silently overcount by one day.
   */
  private periodDayCount(period: PayrollPeriod): number {
    return Math.floor((period.endDate.getTime() - period.startDate.getTime()) / 86_400_000) + 1;
  }

  /**
   * Suggested (never forced) per-day deduction for a MONTHLY employee's
   * ABSENT/HALF_DAY marking — `base salary ÷ actual period length`. Uses the
   * period's real day count (already vendor-derived from
   * PayrollVendorConfig.cutoffDay, not a fixed calendar month), not a
   * hardcoded 26/30/31 divisor — same reasoning already used to justify
   * WEEKLY's ÷7 in `resolvePeriodBase` above. The admin can accept, edit, or
   * clear this suggestion; it never posts anything on its own.
   */
  private suggestedMonthlyDailyRate(baseAmount: number, period: PayrollPeriod): number {
    return roundToNearestRupee(baseAmount / this.periodDayCount(period));
  }

  /**
   * One row per employee for a period — table view, enriched with lightweight
   * review signals (Monthly Payroll row-level triage, owner-requested) so an
   * admin can tell which rows need a closer look before opening any of them.
   * Every signal is an existence/count check reusing a definition already
   * used elsewhere in this module (`periodDayCount`, the attendance-period
   * window) — none of them re-derive bucket totals or duplicate
   * `computeEntryBreakdown`'s math. Also attaches each entry's settled amount
   * (`SettlementService.record`'s own summation, reused verbatim — a plain
   * `groupBy` sum, not a new settlement rule) so Monthly Payroll can show
   * Not Paid / Partially Paid without opening `SettlementDialog`. All four
   * extra queries are batched across the whole period in one round trip
   * each, not per employee.
   */
  async listForPeriod(user: AuthUser, periodId: string) {
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id: periodId, vendorId: user.vendorId } });
    if (!period) throw new NotFoundException('Payroll period not found.');

    const entries = await this.prisma.payrollEntry.findMany({
      where: { periodId, vendorId: user.vendorId },
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    if (entries.length === 0) return entries;

    const userIds = entries.map((e) => e.userId);
    const entryIds = entries.map((e) => e.id);
    const periodDayCount = this.periodDayCount(period);

    const [attendanceCounts, pendingInstallments, latestLedgerActivity, settledAmounts] = await Promise.all([
      this.prisma.staffAttendance.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, date: { gte: period.startDate, lte: period.endDate } },
        _count: { _all: true },
      }),
      this.prisma.staffAdvanceInstallment.findMany({
        where: { periodId, status: AdvanceInstallmentStatus.PENDING, plan: { userId: { in: userIds } } },
        select: { plan: { select: { userId: true } } },
      }),
      // Existence-only signal, deliberately simplified vs `resolveCashWindow`'s per-category
      // split: "did anything POSTED for this employee in the attendance period after this
      // entry was last computed" is a nudge to go look, not a source of truth for any amount.
      this.prisma.staffLedgerEntry.groupBy({
        by: ['userId'],
        where: {
          vendorId: user.vendorId,
          userId: { in: userIds },
          status: LedgerEntryStatus.POSTED,
          effectiveDate: { gte: period.startDate, lte: period.endDate },
        },
        _max: { createdAt: true },
      }),
      this.prisma.settlement.groupBy({
        by: ['payrollEntryId'],
        where: { payrollEntryId: { in: entryIds } },
        _sum: { amount: true },
      }),
    ]);

    const markedDaysByUser = new Map(attendanceCounts.map((r) => [r.userId, r._count._all]));
    const pendingInstallmentUserIds = new Set(pendingInstallments.map((r) => r.plan.userId));
    const latestLedgerActivityByUser = new Map(latestLedgerActivity.map((r) => [r.userId, r._max.createdAt]));
    const settledAmountByEntry = new Map(settledAmounts.map((r) => [r.payrollEntryId, r._sum.amount ?? 0]));

    return entries.map((entry) => {
      const latestActivity = latestLedgerActivityByUser.get(entry.userId);
      return {
        ...entry,
        unmarkedAttendanceDays: Math.max(0, periodDayCount - (markedDaysByUser.get(entry.userId) ?? 0)),
        hasPendingInstallment: pendingInstallmentUserIds.has(entry.userId),
        settledAmount: settledAmountByEntry.get(entry.id) ?? 0,
        hasUnreflectedChanges: !!latestActivity && latestActivity > entry.updatedAt,
      };
    });
  }

  /**
   * The single source of truth for "what does this employee's payroll look
   * like right now" — used by BOTH `generateDraft` (while the entry is still
   * DRAFT, a live preview) AND `PayrollPeriodService.lockPeriod` (which
   * recomputes fresh at the moment of locking rather than trusting whatever
   * was last stored at generate/regenerate time — a ledger entry posted
   * after approval, or voided after approval, must never diverge between
   * what's frozen into the snapshot and what actually got claimed). Runs
   * inside the caller's transaction so lock-time claiming and this
   * computation always see the same data.
   */
  async computeEntryBreakdown(
    tx: Prisma.TransactionClient,
    vendorId: string,
    userId: string,
    period: PayrollPeriod,
    baseSalary: number,
  ): Promise<{ buckets: BucketTotals; ledgerEntryIds: string[]; carryForwardIn: number; finalPayable: number }> {
    const { buckets, ledgerEntryIds } = await this.computeLedgerContribution(tx, vendorId, userId, period);
    const carryForwardIn = await this.computeCarryForwardIn(tx, vendorId, userId, period);
    const finalPayable =
      baseSalary +
      buckets.bonuses +
      buckets.overtime +
      buckets.incentives +
      buckets.advances +
      buckets.expenses +
      buckets.penalties +
      buckets.otherDeductions +
      carryForwardIn;

    return { buckets, ledgerEntryIds, carryForwardIn, finalPayable };
  }

  /**
   * Sums every POSTED, not-yet-claimed StaffLedgerEntry dated within the
   * period into its bucket column, and returns the exact ids summed.
   * `payrollEntryId: null` scopes to entries not yet claimed by any payroll
   * lock. Both the bucket totals AND the id list come from this ONE query —
   * there is no second, separately-maintained query anywhere that decides
   * which ledger entries to claim, so the numbers frozen into a snapshot and
   * the rows actually claimed can never disagree.
   */
  private async computeLedgerContribution(
    tx: Prisma.TransactionClient,
    vendorId: string,
    userId: string,
    period: PayrollPeriod,
  ): Promise<{ buckets: BucketTotals; ledgerEntryIds: string[] }> {
    const cashWindow = await this.resolveCashWindow(tx, vendorId, period);

    const ledgerEntries = await tx.staffLedgerEntry.findMany({
      where: {
        vendorId,
        userId,
        status: LedgerEntryStatus.POSTED,
        payrollEntryId: null,
        // Advance Installments — a plan's ADVANCE_DISBURSEMENT never enters any
        // PayrollEntry bucket (see bucketKeyForCategory); only its
        // ADVANCE_RECOVERY installments do, each in the window it's collected.
        category: { not: StaffLedgerCategory.ADVANCE_DISBURSEMENT },
        ...this.ledgerWindowFilter(period, cashWindow),
      },
      select: { id: true, category: true, amount: true },
    });

    const buckets = emptyBuckets();
    const ledgerEntryIds: string[] = [];
    for (const ledgerEntry of ledgerEntries) {
      buckets[bucketKeyForCategory(ledgerEntry.category)] += ledgerEntry.amount;
      ledgerEntryIds.push(ledgerEntry.id);
    }
    return { buckets, ledgerEntryIds };
  }

  /**
   * The vendor's optional cash-deduction window (`PayrollVendorConfig.
   * cashCutoffDay`/`cashWindowCategories` — see the schema comment). Returns
   * `null` when disabled (no `cashCutoffDay` set, or no category opted in)
   * so every caller falls back to the single attendance-period query,
   * byte-identical to before this feature existed. When enabled, the
   * window's cycle is `computeCycleForCutoff()` anchored on `cashCutoffDay`,
   * for the cycle containing the ATTENDANCE period's own `endDate` — i.e.
   * "whichever cashCutoffDay-cycle this payroll run's payout falls in".
   * Accepts either a live transaction client or the plain `PrismaService`
   * (structurally compatible with `Prisma.TransactionClient`) since
   * `getBreakdown` — a read-only, non-transactional call — needs the same
   * resolution outside of `generateDraft`/`lockPeriod`'s transaction.
   */
  private async resolveCashWindow(
    prismaOrTx: Prisma.TransactionClient | PrismaService,
    vendorId: string,
    period: PayrollPeriod,
  ): Promise<{ startDate: Date; endDate: Date; categories: StaffLedgerCategory[] } | null> {
    const config = await prismaOrTx.payrollVendorConfig.findUnique({ where: { vendorId } });
    if (!config?.cashCutoffDay || config.cashWindowCategories.length === 0) return null;

    const { startDate, endDate } = computeCycleForCutoff(config.cashCutoffDay, period.endDate);
    return { startDate, endDate, categories: config.cashWindowCategories };
  }

  /**
   * The `effectiveDate` (+ category split, when a cash window is active)
   * clause shared by `computeLedgerContribution` and `getBreakdown` — the
   * ONE place either query decides which window a category's rows come
   * from, so the numbers actually summed and the rows displayed as "why"
   * can never disagree. `cashWindow == null` (the default for every vendor
   * that hasn't opted in) reduces to the original single-window filter.
   */
  private ledgerWindowFilter(
    period: PayrollPeriod,
    cashWindow: { startDate: Date; endDate: Date; categories: StaffLedgerCategory[] } | null,
  ): Prisma.StaffLedgerEntryWhereInput {
    if (!cashWindow) {
      return { effectiveDate: { gte: period.startDate, lte: period.endDate } };
    }
    return {
      OR: [
        { category: { in: cashWindow.categories }, effectiveDate: { gte: cashWindow.startDate, lte: cashWindow.endDate } },
        { category: { notIn: cashWindow.categories }, effectiveDate: { gte: period.startDate, lte: period.endDate } },
      ],
    };
  }

  /**
   * carryForwardIn = previous period's (finalPayable - sum of its
   * Settlement amounts), read from that same employee's PayrollEntry in the
   * immediately preceding PayrollPeriod for this vendor. 0 if no previous
   * period/entry exists. May be negative (employee was overpaid last
   * period) — that flows through unclamped.
   */
  private async computeCarryForwardIn(
    tx: Prisma.TransactionClient,
    vendorId: string,
    userId: string,
    period: PayrollPeriod,
  ): Promise<number> {
    const previousPeriod = await tx.payrollPeriod.findFirst({
      where: { vendorId, endDate: { lt: period.startDate } },
      orderBy: { endDate: 'desc' },
    });
    if (!previousPeriod) return 0;

    const previousEntry = await tx.payrollEntry.findUnique({
      where: { periodId_userId: { periodId: previousPeriod.id, userId } },
    });
    if (!previousEntry) return 0;

    const settled = await tx.settlement.aggregate({
      where: { payrollEntryId: previousEntry.id },
      _sum: { amount: true },
    });

    return previousEntry.finalPayable - (settled._sum.amount ?? 0);
  }

  /**
   * Resolves the period's base salary from the employee's effective
   * SalaryStructure (§4 Phase 3). `MONTHLY` returns `structure.baseAmount`
   * **unchanged** — byte-identical to the pre-Phase-3 flat copy this line
   * used to be, no arithmetic, no attendance read, so a MONTHLY-only vendor's
   * output cannot move by even one rupee.
   *
   * `DAILY` / `WEEKLY` reinterpret `baseAmount` as a rate (a daily rate, or a
   * rate per 7-calendar-day week — never a new column, see the schema
   * comment on `PayFrequency`) and multiply it by the employee's attended
   * units for the period, rounded once via `roundToNearestRupee`. "Attended
   * units" is a straight count of that employee's own `StaffAttendance` rows
   * (PRESENT = 1, HALF_DAY = 0.5) — never a hardcoded 26/30/31 working-days
   * divisor (§6.3 C7 forbids exactly that). The WEEKLY→daily-equivalent ÷7 is
   * a fixed unit conversion (a week is unambiguously 7 calendar days), not a
   * business-policy divisor, so it is not the "hidden divisor" C7 warns
   * against — it is the literal meaning of "a weekly rate".
   *
   * Deliberately takes the pre-aggregated `attendance` map entry rather than
   * `period` — the aggregation is already period-scoped by `aggregateAttendance`,
   * so a third `period` parameter here would go unused.
   */
  private resolvePeriodBase(
    structure: { baseAmount: number; payFrequency: PayFrequency },
    attendance: AttendanceAggregate | undefined,
  ): number {
    if (structure.payFrequency === PayFrequency.MONTHLY) {
      return structure.baseAmount;
    }

    const perDayRate =
      structure.payFrequency === PayFrequency.WEEKLY ? structure.baseAmount / 7 : structure.baseAmount;
    const attendedUnits = (attendance?.presentDays ?? 0) + 0.5 * (attendance?.halfDays ?? 0);

    return roundToNearestRupee(perDayRate * attendedUnits);
  }

  /**
   * Pre-aggregates PRESENT / HALF_DAY `StaffAttendance` counts for every
   * employee with a row dated inside this period, in ONE query, ONCE per
   * `generateDraft` run — not once per employee (§4 Phase 3), so the existing
   * single transaction stays short regardless of headcount. ABSENT / LEAVE /
   * WEEKLY_OFF rows, and employees with no attendance row at all, are simply
   * absent from the result map (`resolvePeriodBase` treats a missing entry as
   * zero attended units) — never defaulted to "fully present".
   */
  private async aggregateAttendance(
    tx: Prisma.TransactionClient,
    vendorId: string,
    period: PayrollPeriod,
  ): Promise<Map<string, AttendanceAggregate>> {
    const rows = await tx.staffAttendance.groupBy({
      by: ['userId', 'status'],
      where: {
        vendorId,
        date: { gte: period.startDate, lte: period.endDate },
        status: { in: [AttendanceStatus.PRESENT, AttendanceStatus.HALF_DAY] },
      },
      _count: { _all: true },
    });

    const byUser = new Map<string, AttendanceAggregate>();
    for (const row of rows) {
      const current = byUser.get(row.userId) ?? { presentDays: 0, halfDays: 0 };
      if (row.status === AttendanceStatus.PRESENT) current.presentDays = row._count._all;
      else current.halfDays = row._count._all;
      byUser.set(row.userId, current);
    }
    return byUser;
  }
}
