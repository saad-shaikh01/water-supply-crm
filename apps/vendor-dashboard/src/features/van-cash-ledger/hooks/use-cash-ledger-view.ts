import { useEffect } from 'react';
import { useQueryState, parseAsStringLiteral } from 'nuqs';

export const CASH_LEDGER_VIEWS = ['timeline', 'table'] as const;
export type CashLedgerView = (typeof CASH_LEDGER_VIEWS)[number];

const STORAGE_KEY = 'wsc:cash-ledger:view';

function readStored(): CashLedgerView | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'table' || v === 'timeline' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Timeline | Table view (spec §4.5): lives in the URL (`?view=table`, so a link
 * shares the view) and is remembered per browser (localStorage) as the default
 * for the NEXT visit that has no `view` param. "timeline" is the default and is
 * never written to the URL. Every storage access is guarded — private windows /
 * blocked storage just fall back to the timeline.
 */
export function useCashLedgerView(): [CashLedgerView, (next: CashLedgerView) => void] {
  const [param, setParam] = useQueryState('view', parseAsStringLiteral(CASH_LEDGER_VIEWS));

  // First paint with no `view` param: apply the remembered choice (URL wins when present).
  useEffect(() => {
    if (param !== null) return;
    if (readStored() === 'table') void setParam('table', { history: 'replace' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view: CashLedgerView = param ?? 'timeline';

  const setView = (next: CashLedgerView) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — the URL still carries the choice */
    }
    void setParam(next === 'timeline' ? null : next, { history: 'replace' });
  };

  return [view, setView];
}
