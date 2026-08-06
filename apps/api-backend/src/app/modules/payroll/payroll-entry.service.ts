import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  LedgerEntryStatus,
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
import { PermissionService } from '../authz/permission.service';

function versionMismatch(expected: number, received: number): ConflictException {
  return new ConflictException(`Version mismatch: expected ${expected}, received ${received}. Reload and retry.`);
}

/** Roles that receive a PayrollEntry when a period's draft is generated. */
const PAYROLL_ELIGIBLE_ROLES: UserRole[] = [
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
      for (const employee of eligibleEmployees) {
        const structures = await tx.salaryStructure.findMany({
          where: {
            vendorId: user.vendorId,
            userId: employee.id,
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

        const existingEntry = await tx.payrollEntry.findUnique({
          where: { periodId_userId: { periodId, userId: employee.id } },
        });
        if (existingEntry && existingEntry.status !== PayrollEntryStatus.DRAFT) {
          skippedAlreadyReviewed.push({ userId: employee.id, name: employee.name, status: existingEntry.status });
          continue;
        }

        const baseSalary = structures[0].baseAmount;
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

    const ledgerEntries = await this.prisma.staffLedgerEntry.findMany({
      where: {
        vendorId: user.vendorId,
        userId: entry.userId,
        status: LedgerEntryStatus.POSTED,
        effectiveDate: { gte: entry.period.startDate, lte: entry.period.endDate },
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
      byBucket[bucketKeyForCategory(ledgerEntry.category)].push(ledgerEntry);
    }

    return { entry, ledgerEntriesByBucket: byBucket };
  }

  /** One row per employee for a period — table view. */
  async listForPeriod(user: AuthUser, periodId: string) {
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id: periodId, vendorId: user.vendorId } });
    if (!period) throw new NotFoundException('Payroll period not found.');

    return this.prisma.payrollEntry.findMany({
      where: { periodId, vendorId: user.vendorId },
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { user: { name: 'asc' } },
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
    const ledgerEntries = await tx.staffLedgerEntry.findMany({
      where: {
        vendorId,
        userId,
        status: LedgerEntryStatus.POSTED,
        payrollEntryId: null,
        effectiveDate: { gte: period.startDate, lte: period.endDate },
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
}
