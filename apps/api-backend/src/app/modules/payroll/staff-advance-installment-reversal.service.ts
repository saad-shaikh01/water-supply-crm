import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { AdvanceInstallmentStatus, AdvancePlanStatus, PayrollPeriodStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { StaffLedgerService } from './staff-ledger.service';
import { PayrollEntryService } from './payroll-entry.service';
import { ReverseAdvanceInstallmentDto } from './dto/reverse-advance-installment.dto';

/**
 * "Undo collect" for an advance installment (owner-requested 2026-10-13) — the
 * admin collected this period's installment but wants the employee to repay it
 * from next month instead (skipping this month after the fact).
 *
 * Voids the `ADVANCE_RECOVERY` ledger entry the collect posted and flips the
 * installment to SKIPPED, exactly the state an admin-initiated Skip leaves. The
 * plan's remaining balance is derived from COLLECTED rows, so it is restored
 * automatically and the next period's `ensureInstallmentsForPeriod` schedules
 * the amount again. A COMPLETED plan goes back to ACTIVE.
 *
 * Only possible while the period is still open and the recovery entry has not
 * been rolled into a locked payroll entry. A separate service from
 * `StaffAdvancePlanService` because it needs `PayrollEntryService` (to refresh
 * the DRAFT), which already depends on that service.
 */
@Injectable()
export class StaffAdvanceInstallmentReversalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffLedger: StaffLedgerService,
    private readonly payrollEntries: PayrollEntryService,
  ) {}

  async reverse(user: AuthUser, installmentId: string, dto: ReverseAdvanceInstallmentDto) {
    return this.prisma.$transaction(async (tx) => {
      const installment = await tx.staffAdvanceInstallment.findFirst({
        where: { id: installmentId, vendorId: user.vendorId },
        include: { plan: true, period: true, ledgerEntry: true },
      });
      if (!installment) throw new NotFoundException('Advance installment not found.');
      if (
        installment.period.status === PayrollPeriodStatus.LOCKED ||
        installment.period.status === PayrollPeriodStatus.PAID
      ) {
        throw new BadRequestException('This installment belongs to a period that is already locked — it can no longer be reversed.');
      }
      if (installment.status !== AdvanceInstallmentStatus.COLLECTED || !installment.ledgerEntry) {
        throw new BadRequestException(
          `Only a COLLECTED installment can be reversed (current status: ${installment.status}).`,
        );
      }
      if (installment.plan.status === AdvancePlanStatus.CANCELLED) {
        throw new BadRequestException('This plan was written off — its installments can no longer be reversed.');
      }

      const reason = dto.reason?.trim() || 'Installment collection reversed — moved to next period';
      await this.staffLedger.voidEntryTx(
        tx,
        user,
        installment.ledgerEntry.id,
        { version: installment.ledgerEntry.version, reason },
        { skipCreatorCheck: true },
      );

      const updated = await tx.staffAdvanceInstallment.update({
        where: { id: installmentId },
        data: {
          status: AdvanceInstallmentStatus.SKIPPED,
          actualAmount: 0,
          ledgerEntryId: null,
          decidedById: user.userId,
          decidedAt: new Date(),
        },
      });

      if (installment.plan.status === AdvancePlanStatus.COMPLETED) {
        await tx.staffAdvancePlan.update({
          where: { id: installment.planId },
          data: { status: AdvancePlanStatus.ACTIVE },
        });
      }

      await tx.auditLog.create({
        data: {
          vendorId: user.vendorId,
          userId: user.userId,
          userName: user.name,
          entity: 'StaffAdvanceInstallment',
          entityId: installmentId,
          action: 'REVERSE_COLLECT',
          changes: {
            before: { status: AdvanceInstallmentStatus.COLLECTED, actualAmount: installment.actualAmount },
            after: { status: AdvanceInstallmentStatus.SKIPPED, actualAmount: 0, reason },
          } as Prisma.InputJsonValue,
        },
      });

      // The recovery row just left this period's advances bucket — keep a DRAFT in step.
      await this.payrollEntries.refreshDraftEntryTx(tx, user, installment.plan.userId, installment.period);

      return updated;
    });
  }
}
