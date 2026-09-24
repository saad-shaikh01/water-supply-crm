import { AdvanceInstallmentStatus, Prisma } from '@prisma/client';

/**
 * Remaining balance is deliberately never a stored column (see the schema
 * comment on `StaffAdvancePlan`) — always derived fresh from the same rows
 * that would ever change it, so it can't drift from what's actually been
 * collected. Mirrors `PayrollEntryService.computeCarryForwardIn`'s
 * "derive, don't cache" approach.
 *
 * A plain function (not a service method) so both `StaffAdvancePlanService`
 * and `PayrollEntryService` can call it without one depending on the other —
 * `PayrollEntryService.generateDraft()` needs it inside its own transaction
 * to auto-generate this period's installment.
 */
export async function computeRemainingBalance(
  tx: Prisma.TransactionClient,
  planId: string,
  principalAmount: number,
): Promise<number> {
  const collected = await tx.staffAdvanceInstallment.aggregate({
    where: { planId, status: AdvanceInstallmentStatus.COLLECTED },
    _sum: { actualAmount: true },
  });
  return principalAmount - (collected._sum.actualAmount ?? 0);
}
