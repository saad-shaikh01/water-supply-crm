import { Logger } from '@nestjs/common';
import { DeliveryStatus, PaymentType } from '@prisma/client';

/**
 * Hybrid cash rollups (docs/features/post-close-divergence-banner.md §"Hybrid
 * cash rollups").
 *
 * On a CLOSED sheet, `DailySheet.cashExpected` (= reconciliation
 * `driver.netToHandIn` at close) and `DailySheet.cashCollected` (=
 * `actualCashHandedIn` at close) are frozen snapshots. The retroactive tools
 * (Void Delivery / Edit Closed Delivery / Post-Close Trip Correction / Add
 * Missed Delivery) deliberately never rewrite them. Month-level / list
 * aggregations that blindly SUM those frozen columns therefore go internally
 * inconsistent after a post-close edit (e.g. bottle columns from the live item
 * query drop to 0 while the frozen cash columns stay stale).
 *
 * `resolveSheetCash` gives callers the cash figures to USE in a rollup:
 *   - untouched-after-close (or open) sheet  → the frozen columns, unchanged
 *     (historical months stay byte-identical — hard requirement)
 *   - modified-after-close sheet             → live VOIDED-excluding recompute
 *
 * Callers should detect the (rare) modified sheets cheaply first — see
 * `sheetModifiedAfterCloseWhere` — then targeted-reload only those with
 * `SHEET_CASH_RELOAD_INCLUDE` and call this helper on them.
 */

const logger = new Logger('SheetCashUtil');

// ── Pure reconciliation computation ─────────────────────────────────────────
// Moved verbatim out of DailySheetService.buildReconciliation so dashboard /
// analytics rollups can reuse it without pulling in the whole service. The
// DailySheetService method now delegates here.
export function buildReconciliation(sheet: any) {
  const activeItems = (sheet.items as any[]).filter(
    (i) => i.status === DeliveryStatus.COMPLETED || i.status === DeliveryStatus.EMPTY_ONLY,
  );

  const getPrice = (item: any): number => {
    if (item.pricePerBottle && item.pricePerBottle > 0) return item.pricePerBottle;
    const custom = item.customer?.customPrices?.find(
      (cp: any) => cp.productId === item.productId,
    );
    return custom?.customPrice ?? item.product?.basePrice ?? 0;
  };

  // Bottle summary
  const totalDelivered = activeItems.reduce((s, i) => s + i.filledDropped, 0);
  // Filled bottles received back from customers (account closing / excess stock
  // return) are a second source of filled stock on the van, alongside the
  // warehouse load — they get checked back in as part of filledInCount too, so
  // they must be added to the "in" side for the discrepancy check to balance.
  const totalFilledReceived = activeItems.reduce((s, i) => s + i.filledReceived, 0);
  const bottleDiscrepancy =
    (sheet.filledOutCount + totalFilledReceived) - (sheet.filledInCount + totalDelivered);

  // Empty bottle summary
  const totalEmptyCollected = activeItems.reduce((s, i) => s + i.emptyReceived, 0);
  const emptyDiscrepancy = totalEmptyCollected - sheet.emptyInCount;

  // Cash breakdown by payment type
  const cashItems = activeItems.filter((i) => i.customer?.paymentType === PaymentType.CASH);
  const monthlyItems = activeItems.filter((i) => i.customer?.paymentType === PaymentType.MONTHLY);

  const cashBilled = cashItems.reduce(
    (s, i) => s + getPrice(i) * i.filledDropped, 0,
  );
  const cashCollectedFromCash = cashItems.reduce((s, i) => s + i.cashCollected, 0);

  const monthlyBilled = monthlyItems.reduce(
    (s, i) => s + getPrice(i) * i.filledDropped, 0,
  );

  // Driver handover — ALL cash recorded across every item EXCEPT voided ones
  // (a voided delivery's ledger cash was reversed; its stale item.cashCollected
  // column must not still count toward what the driver owes).
  const totalCashRecorded = (sheet.items as any[])
    .filter((i) => i.status !== DeliveryStatus.VOIDED)
    .reduce((s, i) => s + i.cashCollected, 0);
  const driverDiscrepancy = totalCashRecorded - sheet.cashCollected;

  // Only expenses actually paid out of the driver's van cash-in-hand
  // (paidFromCash, default true) reduce the cash hand-in — a fuel fill or
  // trip expense paid by card/bank/company account never touched that
  // cash, so it must not be subtracted from it. totalExpensesAll is kept
  // for cost-tracking displays (Cash Summary "Expenses" line) which still
  // want the full spend regardless of payment source.
  const allExpenses = (sheet.expenses ?? []) as any[];
  const totalExpensesAll = allExpenses.reduce((s: number, e: any) => s + e.amount, 0);
  const totalExpenses = allExpenses
    .filter((e: any) => e.paidFromCash !== false)
    .reduce((s: number, e: any) => s + e.amount, 0);
  const totalExpensesNonCash = totalExpensesAll - totalExpenses;

  // Crew Cash rows are physical cash already handed to crew off the van
  // (meals/tea/emergency) — the money is gone from the driver's pocket the
  // moment it's recorded, regardless of whether that row has cleared its
  // payroll-approval gate yet (that gate only governs the Payroll Ledger
  // sync, not whether the cash was actually spent). All rows on the sheet
  // must reduce cash-on-hand here, the same way every recorded Expense does.
  const totalCrewCash = ((sheet.crewCashDistributions ?? []) as any[]).reduce(
    (s: number, c: any) => s + c.amount,
    0,
  );

  const pendingCount = (sheet.items as any[]).filter(
    (i) => i.status === DeliveryStatus.PENDING,
  ).length;

  return {
    pendingCount,
    bottles: {
      dispatched: sheet.filledOutCount,
      delivered: totalDelivered,
      returned: sheet.filledInCount,
      receivedFromCustomers: totalFilledReceived,
      discrepancy: bottleDiscrepancy,
    },
    empties: {
      collectedFromCustomers: totalEmptyCollected,
      returnedToWarehouse: sheet.emptyInCount,
      discrepancy: emptyDiscrepancy,
    },
    cashCustomers: {
      count: cashItems.length,
      billed: cashBilled,
      collected: cashCollectedFromCash,
      addedToBalance: cashBilled - cashCollectedFromCash,
    },
    monthlyCustomers: {
      count: monthlyItems.length,
      billedToAccounts: monthlyBilled,
    },
    expenses: {
      // Full spend regardless of payment source (cost-tracking figure).
      total: totalExpensesAll,
      // Subset that actually left the driver's cash — this is what's
      // deducted below in driver.netToHandIn, not `total`.
      paidFromCash: totalExpenses,
      // Subset paid by card/bank/company account — real cost, but never
      // touched the driver's cash so it's excluded from the deduction.
      paidByOther: totalExpensesNonCash,
    },
    crewCash: {
      total: totalCrewCash,
    },
    driver: {
      shouldHandIn: totalCashRecorded,
      expensePaidFromCash: totalExpenses,
      crewCashPaidFromCash: totalCrewCash,
      netToHandIn: Math.max(0, totalCashRecorded - totalExpenses - totalCrewCash),
      handedIn: sheet.cashCollected,
      discrepancy: driverDiscrepancy,
      unexplainedDiscrepancy: driverDiscrepancy - totalExpenses - totalCrewCash,
    },
  };
}

// ── "Modified after close" predicate ───────────────────────────────────────
// The exact predicate the findOne() postCloseDivergence block uses.
// NOTE: `editCount > 0` can, in a rare case, match a pre-close in-window trip
// edit that happened before this sheet was ever closed — accepted minor
// over-recompute (the live recompute is still correct, just unnecessary).
export function isSheetModifiedAfterClose(sheet: {
  items?: any[];
  loads?: any[];
}): boolean {
  const items = (sheet.items ?? []) as any[];
  const loads = (sheet.loads ?? []) as any[];
  return (
    items.some((i) => i.voidedAt != null) ||
    items.some((i) => i.isCorrection && i.correctionAddedAt != null) ||
    loads.some((l) => (l.editCount ?? 0) > 0)
  );
}

/**
 * Prisma `where` fragment (nest under `dailySheetItem` / for loads use
 * `dailySheetLoadModifiedWhere`) that finds the DailySheetItem rows which make
 * a closed sheet "modified after close". Union the `dailySheetId`s from both
 * with the load query below to get the modified-sheet id set for a range.
 */
export const dailySheetItemModifiedOrWhere = [
  { voidedAt: { not: null } },
  { AND: [{ isCorrection: true }, { correctionAddedAt: { not: null } }] },
];

// ── Targeted reload shape ─────────────────────────────────────────────────
// Everything buildReconciliation + the predicate consume. Sheet scalars
// (filledOutCount / filledInCount / emptyInCount / cashCollected / isClosed /
// id) come for free with `include`.
export const SHEET_CASH_RELOAD_INCLUDE = {
  items: {
    select: {
      status: true,
      filledDropped: true,
      filledReceived: true,
      emptyReceived: true,
      cashCollected: true,
      pricePerBottle: true,
      productId: true,
      voidedAt: true,
      isCorrection: true,
      correctionAddedAt: true,
      customer: {
        select: {
          paymentType: true,
          customPrices: { select: { productId: true, customPrice: true } },
        },
      },
      product: { select: { basePrice: true } },
    },
  },
  expenses: { select: { amount: true, paidFromCash: true } },
  crewCashDistributions: { select: { amount: true } },
  loads: { select: { editCount: true } },
} as const;

export interface ResolvedSheetCash {
  cashCollected: number;
  cashExpected: number;
  postCloseModified: boolean;
}

/**
 * The cash figures to USE for a sheet in a month-level / list rollup.
 *
 * - open sheet, or closed-but-untouched sheet → the frozen close-time columns,
 *   unchanged (keeps historical numbers byte-identical).
 * - closed sheet modified after close → live recompute:
 *     cashCollected = buildReconciliation.driver.shouldHandIn
 *                     (Σ item.cashCollected over non-VOIDED items)
 *     cashExpected  = buildReconciliation.driver.netToHandIn
 *
 * Never throws — any buildReconciliation failure falls back to the frozen
 * columns with `postCloseModified: true` and a warn log.
 */
export function resolveSheetCash(sheet: any): ResolvedSheetCash {
  const frozen: ResolvedSheetCash = {
    cashCollected: sheet.cashCollected ?? 0,
    cashExpected: sheet.cashExpected ?? 0,
    postCloseModified: false,
  };

  if (!sheet.isClosed) return frozen;
  if (!isSheetModifiedAfterClose(sheet)) return frozen;

  try {
    const recon = buildReconciliation(sheet);
    return {
      cashCollected: recon.driver.shouldHandIn,
      cashExpected: recon.driver.netToHandIn,
      postCloseModified: true,
    };
  } catch (err) {
    logger.warn(
      `resolveSheetCash fell back to frozen columns for sheet ${sheet?.id}: ${(err as Error).message}`,
    );
    return { ...frozen, postCloseModified: true };
  }
}
