import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { PayrollAuditAction, PayrollEntryStatus, PayrollPeriodStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { PayrollEntryService } from './payroll-entry.service';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

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
  ) {}

  /** All periods for the vendor, newest first — Payroll History (§12). */
  async listPeriods(user: AuthUser) {
    return this.prisma.payrollPeriod.findMany({
      where: { vendorId: user.vendorId },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * Finds the vendor's current OPEN period, or creates one for the current
   * cycle (per `PayrollVendorConfig.cutoffDay`, default 1). Idempotent: an
   * existing OPEN period is always returned as-is, and a period already
   * created for the same computed cycle (any status) is returned rather than
   * duplicated — the (vendorId, periodLabel) unique constraint backstops
   * this at the database level regardless.
   */
  async getOrCreateOpenPeriod(user: AuthUser) {
    const existingOpen = await this.prisma.payrollPeriod.findFirst({
      where: { vendorId: user.vendorId, status: PayrollPeriodStatus.OPEN },
      orderBy: { startDate: 'desc' },
    });
    if (existingOpen) return existingOpen;

    const config = await this.prisma.payrollVendorConfig.findUnique({ where: { vendorId: user.vendorId } });
    const cutoffDay = config?.cutoffDay ?? 1;
    const { startDate, endDate, periodLabel } = this.computeCurrentCycle(cutoffDay, new Date());

    const existingByLabel = await this.prisma.payrollPeriod.findUnique({
      where: { vendorId_periodLabel: { vendorId: user.vendorId, periodLabel } },
    });
    if (existingByLabel) return existingByLabel;

    return this.prisma.payrollPeriod.create({
      data: { vendorId: user.vendorId, periodLabel, startDate, endDate, status: PayrollPeriodStatus.OPEN },
    });
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

      for (const entry of entries) {
        const approvedFinalPayable = entry.finalPayable;
        const { buckets, ledgerEntryIds, carryForwardIn, finalPayable } = await this.payrollEntries.computeEntryBreakdown(
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
          data: { ...buckets, carryForwardIn, finalPayable, status: PayrollEntryStatus.LOCKED },
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

  /**
   * The pay cycle (start/end/label) covering `reference`, anchored on
   * `cutoffDay` (the day-of-month the cycle starts). All-UTC to avoid
   * server-timezone drift. A cycle runs [cutoffDay of month M, cutoffDay - 1
   * of month M+1]; `reference` falls in month M's cycle once its
   * day-of-month reaches `cutoffDay`, otherwise it's still in the prior
   * month's cycle. `periodLabel` is the cycle's start year-month, e.g.
   * cutoffDay=1 gives plain calendar months labeled by that month.
   */
  private computeCurrentCycle(
    cutoffDay: number,
    reference: Date,
  ): { startDate: Date; endDate: Date; periodLabel: string } {
    const day = reference.getUTCDate();
    let cycleStartYear = reference.getUTCFullYear();
    let cycleStartMonth = reference.getUTCMonth();

    if (day < cutoffDay) {
      cycleStartMonth -= 1;
      if (cycleStartMonth < 0) {
        cycleStartMonth = 11;
        cycleStartYear -= 1;
      }
    }

    const startDate = new Date(Date.UTC(cycleStartYear, cycleStartMonth, cutoffDay, 0, 0, 0, 0));

    const endDate = new Date(Date.UTC(cycleStartYear, cycleStartMonth + 1, cutoffDay, 0, 0, 0, 0));
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    endDate.setUTCHours(23, 59, 59, 999);

    const periodLabel = `${startDate.getUTCFullYear()}-${pad2(startDate.getUTCMonth() + 1)}`;

    return { startDate, endDate, periodLabel };
  }
}
