import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { PayrollAuditAction, PayrollEntryStatus, PayrollPeriodStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { PayrollEntryService } from './payroll-entry.service';
import { StaffAdvancePlanService } from './staff-advance-plan.service';
import { computeCycleForCutoff } from './payroll-cycle.util';
import { vendorTodayString } from '../../common/helpers/date.util';

/**
 * One row per vendor per pay period (§ schema module note, PayrollPeriod).
 * Owns the OPEN/REVIEW/LOCKED/PAID lifecycle. Period creation is an explicit
 * call in this dispatch — cron-based auto-rollover is future work.
 */
@Injectable()
export class PayrollPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollEntries: PayrollEntryService,
    private readonly advancePlans: StaffAdvancePlanService,
  ) {}

  /** All periods for the vendor, newest first — Payroll History (§12). */
  async listPeriods(user: AuthUser) {
    return this.prisma.payrollPeriod.findMany({
      where: { vendorId: user.vendorId },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * The vendor's current SETTLEMENT period — the one payroll work (generate /
   * approve / lock) is happening on right now: the OLDEST period still OPEN or
   * REVIEW. Several can be active at once (e.g. September still collecting
   * deductions until the 10th while October has already started); the oldest
   * is the one that must be locked first, see `assertNoEarlierActivePeriod`.
   * LOCKED/PAID periods are never the pointer — their payments are recorded
   * per-entry from that period's own page. When nothing is OPEN/REVIEW, falls
   * back to the period containing today (created if missing).
   *
   * This is NOT the attendance period — that follows the calendar, not payroll
   * status. Both resolve their row through `ensurePeriodForDate`.
   */
  async getOrCreateOpenPeriod(user: AuthUser) {
    const oldestActive = await this.prisma.payrollPeriod.findFirst({
      where: { vendorId: user.vendorId, status: { in: [PayrollPeriodStatus.OPEN, PayrollPeriodStatus.REVIEW] } },
      orderBy: { startDate: 'asc' },
    });
    if (oldestActive) return oldestActive;

    return this.ensurePeriodForDate(user.vendorId);
  }

  /**
   * The period the Attendance grid should show: the one containing TODAY
   * (Asia/Karachi), created if missing. Deliberately takes no date/id from the
   * caller — it can only ever resolve (or create) today's period, never an
   * arbitrary, past or future one — and ignores payroll status entirely, so
   * October attendance starts on 1 Oct while September is still being settled.
   * Gated on `payroll:attendance_view` at the controller, not period_generate.
   */
  async getCurrentAttendancePeriod(user: AuthUser) {
    return this.ensurePeriodForDate(user.vendorId);
  }

  /**
   * Idempotent find-or-create of the period whose date range contains the
   * vendor-timezone (Asia/Karachi) calendar day of `now`, cycle per
   * `PayrollVendorConfig.cutoffDay` (default 1). Whatever its status — an
   * existing LOCKED/PAID row is returned as-is, never re-created or reopened.
   *
   * Looked up by RANGE, not label, so a changed `cutoffDay` can't make a label
   * match a row covering different dates. If a concurrent caller created the
   * row first (unique (vendorId, periodLabel) → P2002) the winner is re-read.
   * A row that holds the label but does NOT cover the date (cutoffDay changed
   * mid-history) is a conflict to resolve by hand, never silently returned.
   *
   * Callers: the settlement pointer today; the attendance current-period
   * endpoint and a scheduler are intended to share it.
   */
  async ensurePeriodForDate(vendorId: string, now: Date = new Date()) {
    // `computeCycleForCutoff` is all-UTC: hand it the UTC midnight of the PKT calendar
    // day, otherwise 00:00–05:00 PKT on the 1st (still the previous UTC day) resolves
    // to the previous cycle.
    const reference = new Date(`${vendorTodayString(now)}T00:00:00.000Z`);

    const findCovering = () =>
      this.prisma.payrollPeriod.findFirst({
        where: { vendorId, startDate: { lte: reference }, endDate: { gte: reference } },
      });

    const existing = await findCovering();
    if (existing) return existing;

    const config = await this.prisma.payrollVendorConfig.findUnique({ where: { vendorId } });
    const { startDate, endDate, periodLabel } = computeCycleForCutoff(config?.cutoffDay ?? 1, reference);

    try {
      return await this.prisma.payrollPeriod.create({
        data: { vendorId, periodLabel, startDate, endDate, status: PayrollPeriodStatus.OPEN },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;

      const winner = await findCovering();
      if (winner) return winner;
      throw new ConflictException(
        `A payroll period labelled ${periodLabel} already exists but does not cover ${vendorTodayString(now)} ` +
          `(was the cut-off day changed?). Resolve it before continuing.`,
      );
    }
  }

  /**
   * A period may only be locked once every EARLIER period is out of OPEN/REVIEW:
   * the next period's carry-forward reads this one's frozen `finalPayable` and
   * settlements, so locking out of order would freeze a stale carry-forward.
   * Earlier periods with no entries are ignored — `lockPeriod` itself refuses
   * to lock an empty period, so counting them would deadlock the vendor.
   */
  private async assertNoEarlierActivePeriod(
    tx: Prisma.TransactionClient,
    vendorId: string,
    period: { startDate: Date },
  ) {
    const earlier = await tx.payrollPeriod.findFirst({
      where: {
        vendorId,
        endDate: { lt: period.startDate },
        status: { in: [PayrollPeriodStatus.OPEN, PayrollPeriodStatus.REVIEW] },
        entries: { some: {} },
      },
      orderBy: { startDate: 'asc' },
      select: { periodLabel: true },
    });
    if (earlier) {
      throw new BadRequestException(
        `Cannot lock this period — the earlier period ${earlier.periodLabel} is still open. Lock it first.`,
      );
    }
  }

  /**
   * Locks a period: requires every PayrollEntry in it to be APPROVED first
   * (rejects, listing unresolved employees, rather than partially locking).
   *
   * For each entry, recomputes the ledger-derived portion of the breakdown
   * fresh — via `PayrollEntryService.computeEntryBreakdown`, the exact same
   * method `generateDraft` uses — rather than trusting whatever
   * bucket/finalPayable values were last stored at generate/regenerate time.
   * There is a real time gap between generate -> approve -> lock, during
   * which a new StaffLedgerEntry can get POSTED into the period's date
   * range, or an already-counted one can get VOIDED; recomputing fresh at
   * the instant of locking is what guarantees the snapshot, the entry's own
   * stored bucket columns, and the set of StaffLedgerEntry ids claimed
   * (`payrollEntryId` set) all derive from that ONE computation and can
   * never disagree with each other. If the freshly-recomputed finalPayable
   * differs from what was stored when the entry was last approved, both
   * values are recorded on the snapshot (`approvedFinalPayable` vs
   * `finalPayable`) so a manager can see a late change occurred — it never
   * blocks the lock.
   *
   * KNOWN NARROW GAP (tracked, not fixed here): `baseSalary` itself is NOT
   * re-derived from SalaryStructure at lock time — this recompute only
   * covers the ledger-derived buckets/carry-forward. A raise whose
   * SalaryStructure row is created in the narrow window between this
   * entry's last approve and its lock will not be reflected until the
   * following period (re-running `generateDraft` before approval already
   * picks up any current raise, since it always re-derives baseSalary from
   * the structure effective on the period's end date — this gap only
   * affects an entry that's already APPROVED when the raise lands).
   */
  async lockPeriod(user: AuthUser, periodId: string) {
    return this.prisma.$transaction(async (tx) => {
      const period = await tx.payrollPeriod.findFirst({ where: { id: periodId, vendorId: user.vendorId } });
      if (!period) throw new NotFoundException('Payroll period not found.');

      if (period.status === PayrollPeriodStatus.LOCKED || period.status === PayrollPeriodStatus.PAID) {
        throw new BadRequestException(`Period is already ${period.status}.`);
      }

      const entries = await tx.payrollEntry.findMany({
        where: { periodId, vendorId: user.vendorId },
        include: { user: { select: { name: true } } },
      });
      if (entries.length === 0) {
        throw new BadRequestException('Cannot lock a period with no payroll entries — generate the draft first.');
      }

      const unresolved = entries.filter((entry) => entry.status !== PayrollEntryStatus.APPROVED);
      if (unresolved.length > 0) {
        throw new BadRequestException(
          `Cannot lock period — the following entries are not yet APPROVED: ${unresolved
            .map((entry) => `${entry.user.name} (${entry.status})`)
            .join(', ')}`,
        );
      }

      await this.assertNoEarlierActivePeriod(tx, user.vendorId, period);

      for (const entry of entries) {
        const approvedFinalPayable = entry.finalPayable;
        const { buckets, ledgerEntryIds, carryForwardIn, deferredIn, deferredOut, finalPayable } = await this.payrollEntries.computeEntryBreakdown(
          tx,
          user.vendorId,
          entry.userId,
          period,
          entry.baseSalary,
        );

        const breakdownJson: Record<string, unknown> = {
          baseSalary: entry.baseSalary,
          ...buckets,
          carryForwardIn,
          deferredIn,
          deferredOut,
          finalPayable,
        };
        if (finalPayable !== approvedFinalPayable) {
          breakdownJson.approvedFinalPayable = approvedFinalPayable;
        }

        await tx.payrollSnapshot.create({
          data: {
            payrollEntryId: entry.id,
            breakdownJson: breakdownJson as Prisma.InputJsonValue,
            ledgerEntryIds,
            createdById: user.userId,
          },
        });

        if (ledgerEntryIds.length > 0) {
          await tx.staffLedgerEntry.updateMany({
            where: { id: { in: ledgerEntryIds }, vendorId: user.vendorId },
            data: { payrollEntryId: entry.id },
          });
        }

        await tx.payrollEntry.update({
          where: { id: entry.id, vendorId: user.vendorId },
          data: { ...buckets, carryForwardIn, deferredIn, deferredOut, finalPayable, status: PayrollEntryStatus.LOCKED },
        });

        await tx.payrollEntryAuditLog.create({
          data: {
            payrollEntryId: entry.id,
            actorId: user.userId,
            actorRole: user.role,
            action: PayrollAuditAction.LOCKED,
            beforeJson: { finalPayable: approvedFinalPayable },
            afterJson: { finalPayable },
          },
        });
      }

      // Advance Installments — finalize any installment an admin never
      // actioned this period, same "finalize open decisions at lock time"
      // spirit as everything else above. Auto-skipped, not silently dropped —
      // the balance rolls into next period exactly as a manual Skip would.
      await this.advancePlans.autoSkipPendingForPeriod(tx, user.vendorId, periodId, user.userId);

      const updatedPeriod = await tx.payrollPeriod.update({
        where: { id: periodId },
        data: { status: PayrollPeriodStatus.LOCKED, lockedAt: new Date(), lockedById: user.userId },
      });

      return { period: updatedPeriod, lockedEntryCount: entries.length };
    });
  }

  /**
   * Unlocks a LOCKED period back to REVIEW. `reason` is mandatory. Every
   * entry in the period goes back to APPROVED (not DRAFT — nothing
   * computed was lost) and every StaffLedgerEntry that pointed at those
   * entries is freed (`payrollEntryId` cleared) so a future re-lock can
   * re-claim them. Existing PayrollSnapshot rows are never touched or
   * deleted — a re-lock creates a new one.
   */
  async unlockPeriod(user: AuthUser, periodId: string, reason: string) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('A reason is required to unlock a payroll period.');
    }

    return this.prisma.$transaction(async (tx) => {
      const period = await tx.payrollPeriod.findFirst({ where: { id: periodId, vendorId: user.vendorId } });
      if (!period) throw new NotFoundException('Payroll period not found.');

      if (period.status !== PayrollPeriodStatus.LOCKED) {
        throw new BadRequestException(`Only LOCKED periods can be unlocked (current status: ${period.status}).`);
      }

      const entries = await tx.payrollEntry.findMany({ where: { periodId, vendorId: user.vendorId } });

      for (const entry of entries) {
        await tx.staffLedgerEntry.updateMany({
          where: { payrollEntryId: entry.id, vendorId: user.vendorId },
          data: { payrollEntryId: null },
        });

        await tx.payrollEntry.update({
          where: { id: entry.id, vendorId: user.vendorId },
          data: { status: PayrollEntryStatus.APPROVED },
        });

        await tx.payrollEntryAuditLog.create({
          data: {
            payrollEntryId: entry.id,
            actorId: user.userId,
            actorRole: user.role,
            action: PayrollAuditAction.UNLOCKED,
            reason,
            beforeJson: { status: entry.status },
            afterJson: { status: PayrollEntryStatus.APPROVED },
          },
        });
      }

      const updatedPeriod = await tx.payrollPeriod.update({
        where: { id: periodId },
        data: { status: PayrollPeriodStatus.REVIEW },
      });

      return { period: updatedPeriod, unlockedEntryCount: entries.length };
    });
  }
}
