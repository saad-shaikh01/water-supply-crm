'use client';

import { useId, useState } from 'react';
import { ChevronDown, ChevronRight, Clock, ListChecks } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import type { CashLedgerDayStatement, CashLedgerRow } from '../api/van-cash-ledger.api';
import { fmtDayKey, signedMoney } from '../format';
import { balanceText, balanceTone } from './timeline-format';
import { DayStatement } from './day-statement';
import { TimelineRow } from './timeline-row';
import { deriveRowActions, type RowActionHandlers, type RowActionPerms } from './row-actions-menu';

interface TimelineDayGroupProps {
  /** PKT `YYYY-MM-DD`. */
  dayKey: string;
  /** Whole-day statement from `meta.dayStatements`; absent on an older server (numbers are then omitted). */
  statement?: CashLedgerDayStatement;
  rows: CashLedgerRow[];
  /** True when more rows of this day may still be on an unloaded page (hides the closing footer). */
  continues?: boolean;
  perms: RowActionPerms;
  handlers: RowActionHandlers;
}

/**
 * One business day: a sticky, collapsible header (date + one-line statement),
 * an expandable full day statement, the day's rows, and a closing footer.
 */
export function TimelineDayGroup({ dayKey, statement, rows, continues, perms, handlers }: TimelineDayGroupProps) {
  const [open, setOpen] = useState(true);
  const [statementOpen, setStatementOpen] = useState(false);
  const panelId = useId();

  const cashIn = statement?.totalCashIn ?? 0;
  const cashOut = statement ? statement.totalExpenses + statement.ownerTransfer + statement.fuelCard : 0;

  const toggleStatement = () => {
    if (!open) {
      setOpen(true);
      setStatementOpen(true);
    } else {
      setStatementOpen((v) => !v);
    }
  };

  return (
    <section aria-label={fmtDayKey(dayKey)}>
      {/* Sticky day header — sits just below the page's sticky filter row (z-30). */}
      <div className="sticky top-[var(--cl-sticky-top,0px)] z-20 bg-background/95 backdrop-blur py-1.5">
        <div className="flex items-stretch rounded-2xl border border-border/50 bg-card/80">
          <h3 className="flex-1 min-w-0 m-0">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((v) => !v)}
              className="w-full min-h-11 flex items-start gap-2 rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.02] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {open ? (
                <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="flex-1 min-w-0 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-4 gap-y-0.5">
                <span className="text-sm font-black">{fmtDayKey(dayKey)}</span>
                {statement && (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-mono text-muted-foreground tabular-nums">
                    <span>
                      Opening{' '}
                      <span className={cn('font-bold', balanceTone(statement.opening) ?? 'text-foreground')}>
                        {balanceText(statement.opening)}
                      </span>
                      {' → '}Closing{' '}
                      <span className={cn('font-bold', balanceTone(statement.closing) ?? 'text-foreground')}>
                        {balanceText(statement.closing)}
                      </span>
                    </span>
                    {cashIn > 0 && <span className="font-bold text-emerald-500">{signedMoney(cashIn)}</span>}
                    {cashOut > 0 && <span className="font-bold text-destructive">{signedMoney(-cashOut)}</span>}
                    {statement.lateCount > 0 && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-border/60 px-1.5 py-0 font-sans font-semibold"
                        title={`${statement.lateCount} ${statement.lateCount === 1 ? 'entry' : 'entries'} dated this day ${statement.lateCount === 1 ? 'was' : 'were'} recorded on a later day`}
                      >
                        <Clock className="h-2.5 w-2.5" aria-hidden />
                        {statement.lateCount} late
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>
          </h3>

          {statement && (
            <button
              type="button"
              aria-expanded={open && statementOpen}
              aria-controls={`${panelId}-statement`}
              aria-label={open && statementOpen ? 'Hide day statement' : 'Show day statement'}
              onClick={toggleStatement}
              className="shrink-0 min-w-11 min-h-11 inline-flex items-center justify-center gap-1.5 rounded-2xl px-3 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-white/[0.02] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ListChecks className="h-4 w-4 sm:hidden" aria-hidden />
              <span className="hidden sm:inline">Statement</span>
              {open && statementOpen ? (
                <ChevronDown className="h-3.5 w-3.5 hidden sm:block" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 hidden sm:block" aria-hidden />
              )}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div id={panelId} className="space-y-2 pt-1">
          {statement && statementOpen && (
            <div id={`${panelId}-statement`}>
              <DayStatement statement={statement} />
            </div>
          )}

          {rows.map((row) => (
            <TimelineRow
              key={`${row.type}:${row.id}`}
              row={row}
              flags={deriveRowActions(row, perms)}
              handlers={handlers}
            />
          ))}

          {statement && !continues && (
            <p className="flex items-baseline justify-end gap-2 px-2 pt-0.5 text-[11px] text-muted-foreground">
              <span>Closing (expected)</span>
              <span className={cn('font-mono font-bold tabular-nums', balanceTone(statement.closing))}>
                {balanceText(statement.closing)}
              </span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
