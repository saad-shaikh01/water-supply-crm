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
import { applyDeductionCeiling } from './payroll-deduction-ceiling.util';
import { attributedWithin, buildLedgerWindowFilter, PENDING_ABSENCE_WHERE, type CashWindow } from './payroll-attribution.util';
import type { SlipDeductionItem } from './payroll-slip.util';

/** The vendor's `PayrollVendorConfig` row, or null when the vendor has never saved one (every default applies). */
type VendorConfigRow = Prisma.PayrollVendorConfigGetPayload<object> | null;

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
        const { buckets, carryForwardIn, deferredIn, deferredOut, finalPayable } = await this.computeEntryBreakdown(
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
            data: { baseSalary, ...buckets, carryForwardIn, deferredIn, deferredOut, finalPayable, version: { increment: 1 } },
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
              deferredIn,
              deferredOut,
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

  /**
   * Atomic CAS: DRAFT -> APPROVED.
   *
   * A MONTHLY employee whose period still has ABSENT / HALF_DAY days nobody has
   * decided on (neither deducted nor explicitly waived/paid) would otherwise be
   * approved at full salary by default — that silent "paid" is exactly what
   * confuses employees. So approval is refused with code
   * `PENDING_ABSENCE_DECISIONS` unless the caller passes
   * `acknowledgePendingAbsences` (the UI shows a confirm dialog first and
   * re-sends). This is a soft gate: it never blocks, it only forces a decision
   * to be made or knowingly skipped.
   */
  async approveEntry(user: AuthUser, entryId: string, version: number, acknowledgePendingAbsences = false) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.payrollEntry.findFirst({
        where: { id: entryId, vendorId: user.vendorId },
        include: { period: true },
      });
      if (!entry) throw new NotFoundException('Payroll entry not found.');

      if (entry.status !== PayrollEntryStatus.DRAFT) {
        throw new BadRequestException(`Only DRAFT entries can be approved (current status: ${entry.status}).`);
      }

      if (!acknowledgePendingAbsences) {
        const pending = (await this.countPendingAbsenceDays(tx, user.vendorId, [entry.userId], entry.period)).get(entry.userId) ?? 0;
        if (pending > 0) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            code: 'PENDING_ABSENCE_DECISIONS',
            pendingAbsenceDays: pending,
            message:
              `${pending} absent/half-day day${pending === 1 ? ' has' : 's have'} no paid/unpaid decision yet — ` +
              'approving now pays them in full. Decide them first, or approve with acknowledgement.',
          });
        }
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
   * Keeps ONE employee's DRAFT entry in step with a decision that just changed what it should total (an
   * absence marked unpaid/paid/reset, a deduction deferred to next month) - inside the caller's transaction, so
   * the decision and the refreshed numbers commit or roll back together. The admin therefore never has to
   * hunt for "Generate Draft", and approval can never be given on a number the decision has already outdated.
   *
   * Strictly a no-op for anything other than a DRAFT: an APPROVED / LOCKED entry is never touched here (an
   * approved one is refreshed by the explicit Recalculate action, a locked one is frozen). Recomputes only
   * the ledger-derived part from the entry's stored \`baseSalary\` - the same math \`recalculateEntry\` runs -
   * and writes the same REGENERATED audit row \`generateDraft\` would. Returns whether a draft was refreshed.
   */
  async refreshDraftEntryTx(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    userId: string,
    period: PayrollPeriod,
  ): Promise<boolean> {
    const entry = await tx.payrollEntry.findUnique({
      where: { periodId_userId: { periodId: period.id, userId } },
    });
    if (!entry || entry.vendorId !== actor.vendorId || entry.status !== PayrollEntryStatus.DRAFT) return false;

    const { buckets, carryForwardIn, deferredIn, deferredOut, finalPayable } = await this.computeEntryBreakdown(
      tx,
      actor.vendorId,
      userId,
      period,
      entry.baseSalary,
    );
    const claim = await tx.payrollEntry.updateMany({
      where: { id: entry.id, vendorId: actor.vendorId, status: PayrollEntryStatus.DRAFT, version: entry.version },
      data: { ...buckets, carryForwardIn, deferredIn, deferredOut, finalPayable, version: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw new ConflictException('This payroll entry was changed by someone else. Reload and retry.');
    }

    await tx.payrollEntryAuditLog.create({
      data: {
        payrollEntryId: entry.id,
        actorId: actor.userId,
        actorRole: actor.role,
        action: PayrollAuditAction.REGENERATED,
        beforeJson: { finalPayable: entry.finalPayable },
        afterJson: { finalPayable },
      },
    });
    return true;
  }

  /**
   * Refreshes an already-APPROVED/UNDER_REVIEW entry's stored buckets, carry-
   * forward and finalPayable from the live ledger — the same math
   * `computeEntryBreakdown` runs at lock time — WITHOUT locking the period or
   * claiming any ledger entry. Exists because `lockPeriod` requires every
   * entry in the period to be APPROVED first (see payroll-period.service.ts),
   * so a ledger entry posted for one employee after their approval can't
   * otherwise reach that employee's Final Payable until the whole period is
   * ready to lock. Status and approval metadata are left untouched — this
   * only refreshes numbers, it does not re-approve.
   */
  async recalculateEntry(user: AuthUser, entryId: string, version: number) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.payrollEntry.findFirst({
        where: { id: entryId, vendorId: user.vendorId },
        include: { period: true },
      });
      if (!entry) throw new NotFoundException('Payroll entry not found.');

      const recalculableStatuses: PayrollEntryStatus[] = [PayrollEntryStatus.APPROVED, PayrollEntryStatus.UNDER_REVIEW];
      if (!recalculableStatuses.includes(entry.status)) {
        throw new BadRequestException(
          `Only APPROVED or UNDER_REVIEW entries can be recalculated (current status: ${entry.status}). ` +
            'A DRAFT entry is refreshed by regenerating the draft; a LOCKED/SETTLED entry is frozen.',
        );
      }

      const before = { finalPayable: entry.finalPayable };
      const { buckets, carryForwardIn, deferredIn, deferredOut, finalPayable } = await this.computeEntryBreakdown(
        tx,
        user.vendorId,
        entry.userId,
        entry.period,
        entry.baseSalary,
      );

      const claim = await tx.payrollEntry.updateMany({
        where: { id: entryId, vendorId: user.vendorId, version },
        data: { ...buckets, carryForwardIn, deferredIn, deferredOut, finalPayable, version: { increment: 1 } },
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
          action: PayrollAuditAction.REGENERATED,
          beforeJson: before,
          afterJson: { finalPayable: updated.finalPayable },
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

    const config = await this.prisma.payrollVendorConfig.findUnique({ where: { vendorId: user.vendorId } });
    const cashWindow = this.cashWindowFromConfig(config, entry.period);

    const ledgerEntries = await this.prisma.staffLedgerEntry.findMany({
      where: {
        vendorId: user.vendorId,
        userId: entry.userId,
        status: LedgerEntryStatus.POSTED,
        ...buildLedgerWindowFilter(entry.period, cashWindow),
      },
      orderBy: { effectiveDate: 'asc' },
      // Only ids — used to tell "typed by hand" entries from ones another feature
      // owns (crew cash, attendance, advance plans, discrepancy), which must be
      // undone from their own screen, not by voiding the ledger row directly.
      include: {
        crewCashSource: { select: { id: true } },
        standaloneCrewCashSource: { select: { id: true } },
        discrepancyCase: { select: { id: true } },
        attendanceLeaveSource: { select: { id: true } },
        advancePlanDisbursementSource: { select: { id: true } },
        advanceInstallmentSource: { select: { id: true } },
        sheetAdvanceSource: { select: { id: true } },
        reversalEntries: { where: { status: { not: LedgerEntryStatus.VOIDED } }, select: { id: true } },
      },
    });

    const managedElsewhere = (e: (typeof ledgerEntries)[number]) =>
      e.crewCashSource
        ? 'Crew Cash'
        : e.standaloneCrewCashSource
          ? 'Crew Cash'
          : e.discrepancyCase
            ? 'Discrepancy case'
            : e.attendanceLeaveSource
              ? 'Attendance'
              : e.advancePlanDisbursementSource || e.advanceInstallmentSource
                ? 'Advance plan'
                : e.sheetAdvanceSource
                  ? 'Daily Sheet advance'
                  : null;

    const byBucket: Record<keyof BucketTotals, Array<Record<string, unknown>>> = {
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
      const {
        crewCashSource, standaloneCrewCashSource, discrepancyCase, attendanceLeaveSource,
        advancePlanDisbursementSource, advanceInstallmentSource, sheetAdvanceSource, reversalEntries, ...row
      } = ledgerEntry;
      byBucket[bucketKeyForCategory(ledgerEntry.category)].push({
        ...row,
        managedElsewhere: managedElsewhere(ledgerEntry),
        alreadyReversed: reversalEntries.length > 0,
      });
    }

    const { structure, attendance } = await this.attendanceSummaryFor(user.vendorId, entry.userId, entry.period);
    const suggestedMonthlyDailyRate =
      structure?.payFrequency === PayFrequency.MONTHLY
        ? this.suggestedMonthlyDailyRate(structure.baseAmount, entry.period)
        : null;
    const advancePlans = await this.advancePlans.listForEmployeePeriod(user.vendorId, entry.userId, entry.periodId);

    return { entry, ledgerEntriesByBucket: byBucket, attendance, suggestedMonthlyDailyRate, advancePlans, cashWindow };
  }

  /**
   * The employee's active salary structure + attendance summary for a period — shared by
   * `getBreakdown` and the salary-slip builder so both read absences the same way.
   * A paid/unpaid decision only exists for a MONTHLY employee: a DAILY/WEEKLY base is already derived from
   * attended days, so an absence there is unpaid by construction (see countPendingAbsenceDays).
   */
  async attendanceSummaryFor(vendorId: string, userId: string, period: PayrollPeriod) {
    const structure = await this.prisma.salaryStructure.findFirst({
      where: {
        vendorId,
        userId,
        voidedAt: null,
        effectiveFrom: { lte: period.endDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.endDate } }],
      },
    });
    const attendance = await this.summarizeAttendance(userId, period, structure?.payFrequency === PayFrequency.MONTHLY);
    return { structure, attendance };
  }

  /**
   * The statement behind an entry's "Other deductions" bucket for the salary slip: every POSTED ledger row the
   * period claims (same window as `getBreakdown`) that folds into `otherDeductions`, oldest first, each with a
   * human description (crew cash category + sheet date + note, the absent day it was charged for, ...).
   */
  async otherDeductionItemsFor(vendorId: string, userId: string, period: PayrollPeriod): Promise<SlipDeductionItem[]> {
    const config = await this.prisma.payrollVendorConfig.findUnique({ where: { vendorId } });
    const rows = await this.prisma.staffLedgerEntry.findMany({
      where: {
        vendorId,
        userId,
        status: LedgerEntryStatus.POSTED,
        category: { not: StaffLedgerCategory.ADVANCE_DISBURSEMENT },
        ...buildLedgerWindowFilter(period, this.cashWindowFromConfig(config, period)),
      },
      orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        crewCashSource: { select: { category: true, notes: true, date: true } },
        standaloneCrewCashSource: { select: { category: true, notes: true, date: true } },
        attendanceLeaveSource: { select: { date: true, status: true } },
      },
    });

    const day = (d: Date) => d.toISOString().slice(0, 10);
    const words = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/^w/, (c) => c.toUpperCase());
    const items: SlipDeductionItem[] = [];
    for (const r of rows) {
      if (bucketKeyForCategory(r.category) !== 'otherDeductions') continue;
      const crew = r.crewCashSource ?? r.standaloneCrewCashSource;
      let group: string;
      let description: string;
      if (r.category === StaffLedgerCategory.CREW_CASH || crew) {
        group = 'Crew cash';
        const parts = [crew ? words(String(crew.category)) : 'Crew cash'];
        if (r.crewCashSource) parts.push(`daily sheet ${day(r.crewCashSource.date)}`);
        const note = crew?.notes ?? r.description;
        if (note) parts.push(note);
        description = parts.join(' - ');
      } else if (r.category === StaffLedgerCategory.LEAVE_UNPAID || r.attendanceLeaveSource) {
        group = 'Absence deductions';
        const a = r.attendanceLeaveSource;
        description = a ? `${a.status === 'HALF_DAY' ? 'Half day' : 'Absent'} on ${day(a.date)}` : (r.description ?? 'Unpaid leave');
      } else if (r.category === StaffLedgerCategory.LEAVE_PAID) {
        group = 'Paid leave adjustments';
        description = r.description ?? 'Paid leave';
      } else if (r.category === StaffLedgerCategory.DEDUCTION) {
        group = 'Other deductions';
        description = r.description ?? 'Deduction';
      } else {
        group = 'Adjustments & corrections';
        description = [words(String(r.category)), r.description].filter(Boolean).join(' - ');
      }
      items.push({ date: r.effectiveDate, group, description, amount: r.amount });
    }
    return items;
  }

  /**
   * Per-employee count of ABSENT / HALF_DAY days in the period that are still
   * undecided (see PENDING_ABSENCE_WHERE). Only MONTHLY employees are counted:
   * a DAILY/WEEKLY employee's base is already derived from attended days, so an
   * absence is unpaid by construction there and deducting it again would charge
   * it twice. Two batched queries for any number of employees.
   */
  async countPendingAbsenceDays(
    client: Prisma.TransactionClient | PrismaService,
    vendorId: string,
    userIds: string[],
    period: PayrollPeriod,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (userIds.length === 0) return result;

    const [structures, grouped] = await Promise.all([
      client.salaryStructure.findMany({
        where: {
          vendorId,
          userId: { in: userIds },
          voidedAt: null,
          effectiveFrom: { lte: period.endDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.endDate } }],
        },
        select: { userId: true, payFrequency: true },
      }),
      client.staffAttendance.groupBy({
        by: ['userId'],
        where: {
          vendorId,
          userId: { in: userIds },
          date: { gte: period.startDate, lte: period.endDate },
          ...PENDING_ABSENCE_WHERE,
        },
        _count: { _all: true },
      }),
    ]);

    const monthly = new Set(structures.filter((st) => st.payFrequency === PayFrequency.MONTHLY).map((st) => st.userId));
    for (const row of grouped) {
      if (monthly.has(row.userId)) result.set(row.userId, row._count._all);
    }
    return result;
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
  private async summarizeAttendance(userId: string, period: PayrollPeriod, decisionsApply: boolean) {
    const rows = await this.prisma.staffAttendance.findMany({
      where: { userId, date: { gte: period.startDate, lte: period.endDate } },
      orderBy: { date: 'asc' },
      include: {
        category: { select: { id: true, name: true } },
        leaveLedgerEntry: { select: { status: true, amount: true, payrollAttributionDate: true } },
      },
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

    // Decision per unpaid-status day: DEDUCTED (a live, non-VOIDED leave entry exists), WAIVED (admin said
    // paid), or PENDING (nobody has decided). Null for every other status — there is nothing to decide.
    const decisionOf = (row: (typeof rows)[number]): 'DEDUCTED' | 'WAIVED' | 'PENDING' | null => {
      if (row.status !== AttendanceStatus.ABSENT && row.status !== AttendanceStatus.HALF_DAY) return null;
      if (row.leaveLedgerEntry && row.leaveLedgerEntry.status !== LedgerEntryStatus.VOIDED) return 'DEDUCTED';
      if (!decisionsApply) return null;
      if (row.deductionWaivedAt) return 'WAIVED';
      return 'PENDING';
    };
    const days = rows.map((row) => ({
      date: row.date,
      status: row.status,
      note: row.note,
      categoryId: row.categoryId,
      categoryName: row.category?.name ?? null,
      decision: decisionOf(row),
      // Kept for backward compatibility with older clients: true only for a LIVE deduction.
      hasDeduction: decisionOf(row) === 'DEDUCTED',
      waivedReason: row.deductionWaivedAt ? (row.deductionWaivedReason ?? null) : null,
      // Rupees deducted for this day (LIVE leave entry only; stored negative, exposed positive).
      deductedAmount: decisionOf(row) === 'DEDUCTED' && row.leaveLedgerEntry ? Math.abs(row.leaveLedgerEntry.amount) : 0,
      // "Deduct next month": the live leave entry is attributed past this period, so THIS period's total excludes it.
      deductionDeferred:
        decisionOf(row) === 'DEDUCTED' &&
        !!row.leaveLedgerEntry?.payrollAttributionDate &&
        row.leaveLedgerEntry.payrollAttributionDate > period.endDate,
    }));

    return {
      ...counts,
      periodDayCount,
      unmarkedDays,
      decisionsApply,
      pendingDecisionDays: days.filter((d) => d.decision === 'PENDING').length,
      days,
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
    // Days that should already HAVE an attendance row — the period's day count
    // capped at "today" (inclusive), never its full length. Without this cap, an
    // in-progress period's future dates (which can have no row yet by definition)
    // would count as "unmarked" and mark every row as needing review until the
    // period actually ends. Same all-UTC convention as `periodDayCount`/
    // `computeCycleForCutoff` — no per-vendor timezone handling here either.
    const now = new Date();
    const elapsedEnd = period.endDate.getTime() < now.getTime() ? period.endDate : now;
    const elapsedDayCount = Math.max(
      0,
      Math.floor((elapsedEnd.getTime() - period.startDate.getTime()) / 86_400_000) + 1,
    );

    const [attendanceCounts, pendingInstallments, latestLedgerActivity, settledAmounts, pendingAbsenceByUser] = await Promise.all([
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
      // Excludes ADVANCE_DISBURSEMENT the same way `computeLedgerContribution` does (see
      // `bucketKeyForCategory` — it's the one category that never claims a bucket), so a
      // disbursement with zero effect on this entry's total can't flag it as needing review.
      this.prisma.staffLedgerEntry.groupBy({
        by: ['userId'],
        where: {
          vendorId: user.vendorId,
          userId: { in: userIds },
          status: LedgerEntryStatus.POSTED,
          category: { not: StaffLedgerCategory.ADVANCE_DISBURSEMENT },
          ...attributedWithin({ gte: period.startDate, lte: period.endDate }),
        },
        _max: { createdAt: true },
      }),
      this.prisma.settlement.groupBy({
        by: ['payrollEntryId'],
        where: { payrollEntryId: { in: entryIds } },
        _sum: { amount: true },
      }),
      this.countPendingAbsenceDays(this.prisma, user.vendorId, userIds, period),
    ]);

    const markedDaysByUser = new Map(attendanceCounts.map((r) => [r.userId, r._count._all]));
    const pendingInstallmentUserIds = new Set(pendingInstallments.map((r) => r.plan.userId));
    const latestLedgerActivityByUser = new Map(latestLedgerActivity.map((r) => [r.userId, r._max.createdAt]));
    const settledAmountByEntry = new Map(settledAmounts.map((r) => [r.payrollEntryId, r._sum.amount ?? 0]));

    return entries.map((entry) => {
      const latestActivity = latestLedgerActivityByUser.get(entry.userId);
      return {
        ...entry,
        unmarkedAttendanceDays: Math.max(0, elapsedDayCount - (markedDaysByUser.get(entry.userId) ?? 0)),
        hasPendingInstallment: pendingInstallmentUserIds.has(entry.userId),
        settledAmount: settledAmountByEntry.get(entry.id) ?? 0,
        hasUnreflectedChanges: !!latestActivity && latestActivity > entry.updatedAt,
        pendingAbsenceDays: pendingAbsenceByUser.get(entry.userId) ?? 0,
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
  ): Promise<{
    buckets: BucketTotals;
    ledgerEntryIds: string[];
    carryForwardIn: number;
    deferredIn: number;
    deferredOut: number;
    finalPayable: number;
  }> {
    // One vendor-wide config row, read ONCE per transaction (generate-draft / lock run this per employee).
    const config = await this.vendorConfigForTx(tx, vendorId);
    const { buckets, ledgerEntryIds } = await this.computeLedgerContribution(tx, vendorId, userId, period, config);
    const { carryForwardIn, deferredIn } = await this.computeCarryForwardIn(tx, vendorId, userId, period);

    // Optional max-deduction ceiling (PayrollVendorConfig.maxDeductionPercent, off by default). With it off
    // and no deferredIn this reduces to exactly `base + every bucket + carry` — see applyDeductionCeiling.
    const { allowedDeduction, deferredOut, netCredit } = applyDeductionCeiling({
      baseSalary,
      deductionNet: buckets.advances + buckets.penalties + buckets.otherDeductions,
      deferredIn,
      maxDeductionPercent: config?.maxDeductionPercent,
    });

    const finalPayable =
      baseSalary +
      buckets.bonuses +
      buckets.overtime +
      buckets.incentives +
      buckets.expenses +
      netCredit +
      carryForwardIn -
      allowedDeduction;

    return { buckets, ledgerEntryIds, carryForwardIn, deferredIn, deferredOut, finalPayable };
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
    config: VendorConfigRow,
  ): Promise<{ buckets: BucketTotals; ledgerEntryIds: string[] }> {
    const cashWindow = this.cashWindowFromConfig(config, period);

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
        ...buildLedgerWindowFilter(period, cashWindow),
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
  private cashWindowFromConfig(config: VendorConfigRow, period: PayrollPeriod): CashWindow | null {
    if (!config?.cashCutoffDay || config.cashWindowCategories.length === 0) return null;

    const { startDate, endDate } = computeCycleForCutoff(config.cashCutoffDay, period.endDate);
    return { startDate, endDate, categories: config.cashWindowCategories };
  }

  /**
   * The vendor's config row, memoised per transaction client. `generateDraft` and `lockPeriod` call
   * `computeEntryBreakdown` once per employee inside ONE transaction; the row cannot change within it, so
   * one lookup serves all of them. Keyed on the transaction object (fresh per `$transaction`), never on the
   * long-lived PrismaService, so nothing is ever served stale across requests.
   */
  private readonly txVendorConfig = new WeakMap<object, Map<string, Promise<VendorConfigRow>>>();

  private vendorConfigForTx(tx: Prisma.TransactionClient, vendorId: string): Promise<VendorConfigRow> {
    let byVendor = this.txVendorConfig.get(tx);
    if (!byVendor) {
      byVendor = new Map();
      this.txVendorConfig.set(tx, byVendor);
    }
    let cached = byVendor.get(vendorId);
    if (!cached) {
      cached = tx.payrollVendorConfig.findUnique({ where: { vendorId } });
      byVendor.set(vendorId, cached);
    }
    return cached;
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
  ): Promise<{ carryForwardIn: number; deferredIn: number }> {
    const none = { carryForwardIn: 0, deferredIn: 0 };
    const previousPeriod = await tx.payrollPeriod.findFirst({
      where: { vendorId, endDate: { lt: period.startDate } },
      orderBy: { endDate: 'desc' },
    });
    if (!previousPeriod) return none; // the vendor's very first period - nothing earlier can exist

    const previousEntry = await tx.payrollEntry.findUnique({
      where: { periodId_userId: { periodId: previousPeriod.id, userId } },
    });
    if (!previousEntry) {
      // No entry in the immediately preceding period (e.g. a month the employee had no salary structure and
      // was skipped). Carry-forward keeps its existing rule (0). But a deduction the max-deduction ceiling held
      // back is still OWED - nothing has charged it since - so look further back for the latest entry and
      // pick up its deferredOut rather than letting it silently vanish.
      const lastEntry = await tx.payrollEntry.findFirst({
        where: { vendorId, userId, period: { endDate: { lt: period.startDate } } },
        orderBy: { period: { endDate: 'desc' } },
        select: { deferredOut: true },
      });
      return lastEntry ? { carryForwardIn: 0, deferredIn: lastEntry.deferredOut ?? 0 } : none;
    }

    const settled = await tx.settlement.aggregate({
      where: { payrollEntryId: previousEntry.id },
      _sum: { amount: true },
    });

    // `deferredOut` is a deduction the previous period did NOT charge (it is already excluded from that
    // entry's finalPayable, so it is not part of the carry) — it is owed now, as this period's `deferredIn`.
    return {
      carryForwardIn: previousEntry.finalPayable - (settled._sum.amount ?? 0),
      deferredIn: previousEntry.deferredOut ?? 0,
    };
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
