'use client';

import { AlertTriangle, Clock, Hourglass } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { useCashLedgerSummary } from '../hooks/use-van-cash-ledger';
import { fmtDayKey, money } from '../format';

interface CashLedgerAlertStripProps {
  /** Opens the Pending Approvals panel (owned by the page). */
  onReview: () => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Conditional alert strip above the summary. Renders nothing when there is
 * nothing to flag. Amber = waiting on someone, destructive = negative cash.
 * Every alert carries an icon AND text — never colour alone.
 */
export function CashLedgerAlertStrip({ onReview }: CashLedgerAlertStripProps) {
  const { data } = useCashLedgerSummary();
  if (!data) return null;

  const { memo, availableBalance } = data;
  const handovers = memo?.pendingHandovers ?? { count: 0, amount: 0 };
  const transfers = memo?.pendingRemittances ?? { count: 0, amount: 0 };
  const advances = memo?.pendingAdvances ?? { count: 0, amount: 0 };
  const firstNegativeDate = memo?.firstNegativeDate ?? null;

  const pendingParts: string[] = [];
  if (handovers.count > 0) pendingParts.push(`${plural(handovers.count, 'handover')} (${money(handovers.amount)})`);
  if (transfers.count > 0) pendingParts.push(`${plural(transfers.count, 'owner transfer')} (${money(transfers.amount)})`);

  const showNegative = !!firstNegativeDate || availableBalance < 0;
  const showAdvances = advances.count > 0 || advances.amount > 0;

  if (pendingParts.length === 0 && !showNegative && !showAdvances) return null;

  return (
    <div className="space-y-2" role="region" aria-label="Cash ledger alerts">
      {pendingParts.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 sm:px-4">
          <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
            <Clock className="h-4 w-4 text-amber-500 shrink-0 mt-0.5 sm:mt-0" aria-hidden />
            <p className="text-xs sm:text-sm font-semibold text-amber-600 dark:text-amber-400 min-w-0 break-words">
              {pendingParts.join(' + ')} awaiting approval
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onReview}
            className="h-11 sm:h-8 rounded-full px-4 text-xs font-bold border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 w-full sm:w-auto shrink-0"
          >
            Review
          </Button>
        </div>
      )}

      {showNegative && (
        <div
          role="alert"
          className="flex items-start sm:items-center gap-2.5 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 sm:px-4"
        >
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5 sm:mt-0" aria-hidden />
          <p className="text-xs sm:text-sm font-semibold text-destructive min-w-0 break-words">
            {firstNegativeDate
              ? `Cash position went negative on ${fmtDayKey(firstNegativeDate)}`
              : 'Cash position is negative'}
            {availableBalance < 0 && ` · available now −${money(availableBalance)}`}
          </p>
        </div>
      )}

      {showAdvances && (
        <div className="flex items-start sm:items-center gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 sm:px-4">
          <Hourglass className="h-4 w-4 text-amber-500 shrink-0 mt-0.5 sm:mt-0" aria-hidden />
          <p className="text-xs sm:text-sm font-semibold text-amber-600 dark:text-amber-400 min-w-0 break-words">
            {money(advances.amount)} in payroll advances awaiting approval — cash may already have left the office
          </p>
        </div>
      )}
    </div>
  );
}
