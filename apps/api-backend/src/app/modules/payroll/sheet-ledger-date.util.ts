import { PayrollPeriodStatus, Prisma } from '@prisma/client';

/**
 * `effectiveDate` for the Payroll Ledger twin of a Daily Sheet cash-out row that is
 * being posted NOW (a Crew Cash row added after its sheet closed, a Sheet Advance).
 *
 * Normally the sheet's own date. But if that date already sits inside a LOCKED/PAID
 * payroll period, an entry dated there would never be picked up by any payroll run
 * (that period is frozen), so it is dated today instead and flows into the open
 * period — the same rule `CrewCashDistributionService.createFreshLedgerEntry`
 * applies to post-close corrections.
 */
export async function resolveSheetLedgerDate(
  tx: Prisma.TransactionClient,
  vendorId: string,
  sheetDate: Date,
): Promise<Date> {
  const lockedPeriod = await tx.payrollPeriod.findFirst({
    where: {
      vendorId,
      startDate: { lte: sheetDate },
      endDate: { gte: sheetDate },
      status: { in: [PayrollPeriodStatus.LOCKED, PayrollPeriodStatus.PAID] },
    },
    select: { id: true },
  });
  return lockedPeriod ? new Date() : sheetDate;
}
