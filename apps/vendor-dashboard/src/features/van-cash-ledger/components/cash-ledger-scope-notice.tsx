'use client';

import { Truck } from 'lucide-react';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { Button } from '@water-supply-crm/ui';
import { useCashLedgerSummary } from '../hooks/use-van-cash-ledger';

/**
 * Shown only in van scope: explains why the office-wide tiers (owner
 * transfers, fuel-card top-ups, crew cash, payroll) are missing, and offers a
 * one-click way back to the office-wide view.
 */
export function CashLedgerScopeNotice() {
  const { data } = useCashLedgerSummary();
  const [, setVanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [, setPage] = useQueryState('page', parseAsInteger.withDefault(1));

  if (data?.scope !== 'VAN') return null;

  const viewOfficeWide = () => {
    void setPage(1);
    void setVanId(null);
  };

  return (
    <div
      role="note"
      className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 sm:px-4"
    >
      <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
        <Truck className="h-4 w-4 text-sky-500 shrink-0 mt-0.5 sm:mt-0" aria-hidden />
        <p className="text-xs sm:text-sm font-semibold text-sky-600 dark:text-sky-400 min-w-0 break-words">
          Van view — Owner transfers, fuel-card top-ups, crew cash and payroll are office-wide and hidden here.
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={viewOfficeWide}
        className="h-11 sm:h-8 rounded-full px-4 text-xs font-bold border-sky-500/40 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 w-full sm:w-auto shrink-0"
      >
        View office-wide
      </Button>
    </div>
  );
}
