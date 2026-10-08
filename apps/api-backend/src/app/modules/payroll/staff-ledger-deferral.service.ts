import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import {
  LedgerEntryStatus,
  PayrollPeriodStatus,
  Prisma,
  StaffLedgerAuditAction,
  StaffLedgerCategory,
} from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { buildLedgerWindowFilter, computeDeferralTarget, type CashWindow } from './payroll-attribution.util';
import { PayrollEntryService } from './payroll-entry.service';
import { computeCycleForCutoff } from './payroll-cycle.util';
import { DeferLedgerEntryDto, UndoDeferLedgerEntryDto } from './dto/defer-ledger-entry.dto';

/** Categories that are bookkeeping fixes themselves, or never reach a payroll bucket — never deferred. */
const NOT_DEFERRABLE_CATEGORIES: StaffLedgerCategory[] = [
  StaffLedgerCategory.ADVANCE_DISBURSEMENT,
  StaffLedgerCategory.REVERSAL,
  StaffLedgerCategory.CORRECTION,
];

function versionMismatch(expected: number, received: number): ConflictException {
  return new ConflictException(`Version mismatch: expected ${expected}, received ${received}. Reload and retry.`);
}

/**
 * "Deduct this next month" for a single staff ledger deduction (owner-requested
 * 2026-10-07) — an advance or penalty the admin wants charged in the following
 * payroll period instead of this one.
 *
 * It moves ONLY the entry's `payrollAttributionDate`; `effectiveDate` is never
 * touched. That matters for an ADVANCE: its real cash left the office on
 * `effectiveDate` and the Cash Ledger dates it by that, so voiding and
 * re-posting it at a later date (the obvious implementation) would silently move
 * the cash outflow into the wrong month. Reversible by `undoDefer`, and every
 * move writes a StaffLedgerAuditLog row (action EDITED, with the reason).
 *
 * A separate service from `StaffLedgerService` so the existing ledger code path
 * is not modified.
 */
@Injectable()
export class StaffLedgerDeferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollEntries: PayrollEntryService,
  ) {}

  /**
   * Re-computes the employee's DRAFT entry for every period whose total this move changes: the one that
   * stops counting the row and the one that starts. Same transaction as the move. Non-draft entries are
   * left alone (see `PayrollEntryService.refreshDraftEntryTx`).
   */
  private async refreshDraftsForMove(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    userId: string,
    dates: Date[],
  ): Promise<void> {
    const seen = new Set<string>();
    for (const date of dates) {
      const period = await tx.payrollPeriod.findFirst({
        where: { vendorId: user.vendorId, startDate: { lte: date }, endDate: { gte: date } },
      });
      if (!period || seen.has(period.id)) continue;
      seen.add(period.id);
      await this.payrollEntries.refreshDraftEntryTx(tx, user, userId, period);
    }
  }

  async defer(user: AuthUser, id: string, dto: DeferLedgerEntryDto) {
    return this.prisma.$transaction(async (tx) => {
      const period = await tx.payrollPeriod.findFirst({ where: { id: dto.periodId, vendorId: user.vendorId } });
      if (!period) throw new NotFoundException('Payroll period not found.');
      if (period.status === PayrollPeriodStatus.LOCKED || period.status === PayrollPeriodStatus.PAID) {
        throw new BadRequestException(`This period is ${period.status} — its entries can no longer be moved.`);
      }

      const config = await tx.payrollVendorConfig.findUnique({ where: { vendorId: user.vendorId } });
      const cashWindow = this.resolveCashWindow(config, period.endDate);

      // The entry must CURRENTLY belong to the period the admin is looking at — the same filter the
      // breakdown/draft use, so what the admin sees and what is moved can never disagree.
      const entry = await tx.staffLedgerEntry.findFirst({
        where: { id, vendorId: user.vendorId, AND: [buildLedgerWindowFilter(period, cashWindow)] },
        include: {
          crewCashSource: { select: { id: true } },
          standaloneCrewCashSource: { select: { id: true } },
          discrepancyCase: { select: { id: true } },
          attendanceLeaveSource: { select: { id: true } },
          advancePlanDisbursementSource: { select: { id: true } },
          advanceInstallmentSource: { select: { id: true } },
          sheetAdvanceSource: { select: { id: true } },
        },
      });
      if (!entry) throw new NotFoundException('This entry is not part of the selected period.');

      if (entry.status !== LedgerEntryStatus.POSTED) {
        throw new BadRequestException(
          `Only a POSTED entry can be deferred (current status: ${entry.status}). Approve it first, or void it.`,
        );
      }
      if (entry.payrollEntryId !== null) {
        throw new BadRequestException('This entry is already rolled into a locked payroll period.');
      }
      if (entry.amount >= 0) {
        throw new BadRequestException('Only a deduction (a negative entry) can be deferred.');
      }
      if (NOT_DEFERRABLE_CATEGORIES.includes(entry.category)) {
        throw new BadRequestException('This kind of entry cannot be deferred.');
      }
      const owner =
        entry.crewCashSource || entry.standaloneCrewCashSource
          ? 'Crew Cash'
          : entry.discrepancyCase
            ? 'a discrepancy case'
            : entry.attendanceLeaveSource
              ? 'Attendance (waive or reset the day there)'
              : entry.advancePlanDisbursementSource || entry.advanceInstallmentSource
                ? 'an advance plan (skip the installment there)'
                : entry.sheetAdvanceSource
                  ? 'a Daily Sheet'
                  : null;
      if (owner) {
        throw new BadRequestException(`This entry is managed by ${owner} — change it from there.`);
      }

      const target = computeDeferralTarget({
        periodEnd: period.endDate,
        cutoffDay: config?.cutoffDay ?? 1,
        cashCutoffDay: config?.cashCutoffDay ?? null,
        cashWindowCategories: config?.cashWindowCategories ?? [],
        category: entry.category,
      });

      const claim = await tx.staffLedgerEntry.updateMany({
        where: { id, vendorId: user.vendorId, version: dto.version, payrollEntryId: null, status: LedgerEntryStatus.POSTED },
        data: { payrollAttributionDate: target, version: { increment: 1 } },
      });
      if (claim.count === 0) throw versionMismatch(entry.version, dto.version);

      // Safety net: if, for any calendar/cutoff quirk, the new date still lands in THIS period's window the
      // "deferral" would silently do nothing. Refuse and roll back rather than pretend it worked.
      const stillHere = await tx.staffLedgerEntry.count({
        where: { id, AND: [buildLedgerWindowFilter(period, cashWindow)] },
      });
      if (stillHere > 0) {
        throw new BadRequestException('Could not move this entry to a later period with the current payroll cutoff settings.');
      }

      await tx.staffLedgerAuditLog.create({
        data: {
          ledgerEntryId: id,
          actorId: user.userId,
          actorRole: user.role,
          action: StaffLedgerAuditAction.EDITED,
          reason: `Deferred to next payroll period: ${dto.reason}`,
          beforeJson: { payrollAttributionDate: entry.payrollAttributionDate },
          afterJson: { payrollAttributionDate: target },
        },
      });

      // The period it just left (still shown to the admin) and the one that now owns it.
      await this.refreshDraftsForMove(tx, user, entry.userId, [period.endDate, target]);

      return tx.staffLedgerEntry.findUniqueOrThrow({ where: { id } });
    });
  }

  async undoDefer(user: AuthUser, id: string, dto: UndoDeferLedgerEntryDto) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.staffLedgerEntry.findFirst({ where: { id, vendorId: user.vendorId } });
      if (!entry) throw new NotFoundException('Ledger entry not found.');
      if (entry.payrollAttributionDate === null) {
        throw new BadRequestException('This entry has not been deferred.');
      }
      if (entry.status !== LedgerEntryStatus.POSTED || entry.payrollEntryId !== null) {
        throw new BadRequestException('Only a POSTED entry that is not yet locked into payroll can be un-deferred.');
      }

      // Putting it back on its original date would strand it if the period it belongs to has since been
      // locked: a locked period never claims anything again, so the deduction would silently never happen.
      const lockedAtOrAfter = await tx.payrollPeriod.findFirst({
        where: {
          vendorId: user.vendorId,
          status: { in: [PayrollPeriodStatus.LOCKED, PayrollPeriodStatus.PAID] },
          endDate: { gte: entry.effectiveDate },
        },
        select: { periodLabel: true },
      });
      if (lockedAtOrAfter) {
        throw new BadRequestException(
          `Cannot move this back — its original payroll period (${lockedAtOrAfter.periodLabel}) is already locked.`,
        );
      }

      const claim = await tx.staffLedgerEntry.updateMany({
        where: { id, vendorId: user.vendorId, version: dto.version, payrollEntryId: null, status: LedgerEntryStatus.POSTED },
        data: { payrollAttributionDate: null, version: { increment: 1 } },
      });
      if (claim.count === 0) throw versionMismatch(entry.version, dto.version);

      await tx.staffLedgerAuditLog.create({
        data: {
          ledgerEntryId: id,
          actorId: user.userId,
          actorRole: user.role,
          action: StaffLedgerAuditAction.EDITED,
          reason: `Deferral undone: ${dto.reason}`,
          beforeJson: { payrollAttributionDate: entry.payrollAttributionDate },
          afterJson: { payrollAttributionDate: null },
        },
      });

      // The period that stops counting it (where it was deferred TO) and the one it returns to.
      await this.refreshDraftsForMove(tx, user, entry.userId, [entry.payrollAttributionDate, entry.effectiveDate]);

      return tx.staffLedgerEntry.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Same resolution as `PayrollEntryService.resolveCashWindow`, from an already-loaded config row. */
  private resolveCashWindow(
    config: { cashCutoffDay: number | null; cashWindowCategories: StaffLedgerCategory[] } | null,
    periodEnd: Date,
  ): CashWindow | null {
    if (!config?.cashCutoffDay || config.cashWindowCategories.length === 0) return null;
    const { startDate, endDate } = computeCycleForCutoff(config.cashCutoffDay, periodEnd);
    return { startDate, endDate, categories: config.cashWindowCategories };
  }
}

