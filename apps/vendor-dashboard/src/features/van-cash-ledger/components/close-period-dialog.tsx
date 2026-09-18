'use client';

import { useEffect, useId, useState } from 'react';
import { AlertTriangle, Ban, Lock, RefreshCw } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Button, Label, Skeleton, Textarea, cn,
} from '@water-supply-crm/ui';
import { useClosePeriod, usePeriodCloseCheck } from '../hooks/use-cash-ledger-periods';
import type { CashLedgerPeriodCloseCheck, PeriodCheckItem } from '../api/van-cash-ledger.api';
import { CASH_LEDGER_BUCKET_META } from '../constants';
import { money, moneyOrDash } from '../format';
import { addMonthsYmd } from '../../../lib/date-pkt';
import { balanceText, periodLabelToDisplay, ymdLong } from './period-drift-chip';

interface ClosePeriodDialogProps {
  /** "YYYY-MM" of the period to close. */
  label: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_NOTE = 500;

/**
 * How to resolve a blocker. Codes come from the server's close-check; matching is tolerant
 * (case-insensitive, substring) so a renamed code still gets a sensible hint, with a generic
 * fallback for anything unknown.
 */
export function blockerHint(item: PeriodCheckItem, check: Pick<CashLedgerPeriodCloseCheck, 'firstDay' | 'lastDay'>): string {
  const code = (item.code ?? '').toUpperCase();
  if (code.includes('PREVIOUS') || code.includes('EARLIER') || code.includes('PRIOR')) {
    const previous = periodLabelToDisplay(addMonthsYmd(check.firstDay, -1).slice(0, 7));
    return `Close ${previous} first.`;
  }
  if (code.includes('NOT_ENDED') || code.includes('NOT_OVER') || code.includes('NOT_FINISHED')) {
    return `The period hasn't ended yet — you can close it after ${ymdLong(check.lastDay)}.`;
  }
  if (code.includes('HANDOVER')) return 'Approve or void the pending handovers first.';
  if (code.includes('REMITTANCE') || code.includes('TRANSFER')) {
    return 'Approve or void the pending owner transfers first.';
  }
  return 'Resolve this item, then check again.';
}

function StatementLine({
  label, value, sign, dotClass, indent, muted,
}: {
  label: string;
  value: string;
  sign?: '+' | '−' | '=';
  dotClass?: string;
  indent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-1', indent && 'pl-6', muted && 'text-muted-foreground')}>
      <dt className="flex items-center gap-2 min-w-0 text-xs sm:text-sm">
        {sign && (
          <span className="w-3 shrink-0 text-center font-mono font-bold text-muted-foreground" aria-hidden>
            {sign}
          </span>
        )}
        {dotClass && <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClass)} aria-hidden />}
        <span className="truncate font-semibold">{label}</span>
      </dt>
      <dd className="font-mono tabular-nums text-xs sm:text-sm font-bold shrink-0">{value}</dd>
    </div>
  );
}

function CheckItemRow({ item, tone }: { item: PeriodCheckItem; tone: 'blocker' | 'warning' }) {
  const Icon = tone === 'blocker' ? Ban : AlertTriangle;
  const hasAmount = item.amount !== null && item.amount !== undefined && item.amount !== 0;
  return (
    <li className="flex items-start gap-2.5 text-xs sm:text-sm">
      <Icon
        className={cn('h-4 w-4 shrink-0 mt-0.5', tone === 'blocker' ? 'text-destructive' : 'text-amber-500')}
        aria-hidden
      />
      <span className="min-w-0 flex-1 font-medium break-words">
        <span className="sr-only">{tone === 'blocker' ? 'Blocker: ' : 'Warning: '}</span>
        {item.message}
      </span>
      {(item.count > 0 || hasAmount) && (
        <span className="shrink-0 font-mono tabular-nums text-[11px] font-bold text-muted-foreground text-right">
          {item.count > 0 && <span>{item.count}×</span>}
          {item.count > 0 && hasAmount && <span> · </span>}
          {hasAmount && <span>{money(item.amount)}</span>}
        </span>
      )}
    </li>
  );
}

/** Close-period confirmation: fresh checklist (blockers / warnings), the statement about to be snapshotted, optional note. */
export function ClosePeriodDialog({ label, open, onOpenChange }: ClosePeriodDialogProps) {
  const check = usePeriodCloseCheck(label, open);
  const closePeriod = useClosePeriod();
  const noteId = useId();
  const ackId = useId();
  const [note, setNote] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (open) {
      setNote('');
      setAcknowledged(false);
    }
  }, [open, label]);

  const data = check.data;
  const displayLabel = data?.displayLabel ?? periodLabelToDisplay(label);
  const blockers = data?.blockers ?? [];
  const warnings = data?.warnings ?? [];
  const alreadyClosed = data?.status === 'CLOSED';

  const canConfirm =
    !!label &&
    !!data &&
    !alreadyClosed &&
    data.canClose &&
    blockers.length === 0 &&
    (warnings.length === 0 || acknowledged) &&
    !closePeriod.isPending;

  const handleClose = () => {
    if (!canConfirm || !label) return;
    closePeriod.mutate(
      {
        label,
        data: {
          note: note.trim() || undefined,
          acknowledgeWarnings: warnings.length > 0 ? true : undefined,
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const meta = CASH_LEDGER_BUCKET_META;
  const st = data?.statement;
  const hasBreakdown = !!st && (st.payrollCash > 0 || st.crewCash > 0);
  const hints = data ? Array.from(new Set(blockers.map((b) => blockerHint(b, data)))) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => (closePeriod.isPending ? undefined : onOpenChange(next))}>
      <DialogContent className="rounded-3xl max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" aria-hidden />
            Close {displayLabel || 'period'}
          </DialogTitle>
          <DialogDescription>
            {data
              ? `${ymdLong(data.firstDay)} → ${ymdLong(data.lastDay)}. Closing locks this month: later edits need an admin override with a reason.`
              : 'Checking the period before it can be closed.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2" aria-live="polite" aria-busy={check.isLoading}>
          {check.isLoading ? (
            <div className="space-y-3" aria-label="Checking the period">
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-40 rounded-2xl" />
            </div>
          ) : check.isError || !data ? (
            <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3">
              <p className="text-sm font-semibold text-destructive">Couldn&apos;t check this period. Nothing was closed.</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void check.refetch()}
                disabled={check.isFetching}
                className="min-h-11 sm:min-h-9 rounded-full gap-1.5"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', check.isFetching && 'animate-spin')} aria-hidden />
                Retry
              </Button>
            </div>
          ) : (
            <>
              {alreadyClosed && (
                <p className="rounded-2xl border border-border/50 bg-muted/30 px-3 py-2.5 text-sm font-medium">
                  This period is already closed.
                </p>
              )}

              {blockers.length > 0 && (
                <section aria-label="Blockers" className="space-y-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-3">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-destructive">
                    Blockers — the period can&apos;t be closed yet
                  </h3>
                  <ul className="space-y-2">
                    {blockers.map((b, i) => <CheckItemRow key={`${b.code}-${i}`} item={b} tone="blocker" />)}
                  </ul>
                  {hints.length > 0 && (
                    <ul className="space-y-0.5 border-t border-destructive/20 pt-2 text-xs text-muted-foreground">
                      {hints.map((h) => <li key={h}>{h}</li>)}
                    </ul>
                  )}
                </section>
              )}

              {warnings.length > 0 && (
                <section aria-label="Warnings" className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-3">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
                    Warnings — review before closing
                  </h3>
                  <ul className="space-y-2">
                    {warnings.map((w, i) => <CheckItemRow key={`${w.code}-${i}`} item={w} tone="warning" />)}
                  </ul>
                  <label
                    htmlFor={ackId}
                    className="flex items-start gap-3 min-h-11 cursor-pointer rounded-lg border-t border-amber-500/20 pt-2.5"
                  >
                    <input
                      id={ackId}
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                      aria-required
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
                    />
                    <span className="text-sm font-semibold">I&apos;ve reviewed these warnings</span>
                  </label>
                </section>
              )}

              {blockers.length === 0 && warnings.length === 0 && !alreadyClosed && (
                <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  All checks passed. Nothing is pending in this period.
                </p>
              )}

              {st && (
                <section aria-label="Statement to be saved" className="space-y-1.5">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Closing statement (office-wide)
                  </h3>
                  <dl className="rounded-2xl border border-border/50 bg-muted/30 px-3 py-2 divide-y divide-border/30">
                    <StatementLine label="Brought forward" value={balanceText(st.broughtForward)} />
                    <StatementLine label="Sheet In" value={money(st.sheetCashIn)} sign="+" dotClass={meta.SHEET_CASH_IN.dot} />
                    <StatementLine label="Office In" value={money(st.officeCashIn)} sign="+" dotClass={meta.OFFICE_CASH_IN.dot} />
                    <StatementLine label="Expenses" value={money(st.totalExpenses)} sign="−" dotClass={meta.OFFICE_EXPENSE.dot} />
                    {hasBreakdown && (
                      <>
                        <StatementLine label="Office expenses" value={money(st.officeExpenses)} indent muted />
                        {st.payrollCash > 0 && (
                          <StatementLine label="Payroll cash" value={money(st.payrollCash)} indent muted dotClass={meta.PAYROLL_CASH.dot} />
                        )}
                        {st.crewCash > 0 && (
                          <StatementLine label="Crew cash" value={money(st.crewCash)} indent muted dotClass={meta.CREW_CASH.dot} />
                        )}
                      </>
                    )}
                    <StatementLine label="Owner Transfer" value={moneyOrDash(st.ownerTransfer)} sign="−" dotClass={meta.OWNER_TRANSFER.dot} />
                    <StatementLine label="Fuel Card" value={moneyOrDash(st.fuelCard)} sign="−" dotClass={meta.FUEL_CARD.dot} />
                    <div className="flex items-center justify-between gap-3 pt-2 pb-1">
                      <dt className="flex items-center gap-2 text-sm font-black">
                        <span className="w-3 shrink-0 text-center font-mono font-bold text-muted-foreground" aria-hidden>=</span>
                        Expected Closing
                      </dt>
                      <dd className="font-mono tabular-nums text-base font-black">{balanceText(st.expectedClosing)}</dd>
                    </div>
                  </dl>
                </section>
              )}

              <div className="space-y-2">
                <Label htmlFor={noteId} className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                  Note <span className="font-medium normal-case tracking-normal">(optional)</span>
                </Label>
                <Textarea
                  id={noteId}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={MAX_NOTE}
                  placeholder="e.g. Reconciled against the bank statement"
                  className="rounded-xl min-h-20"
                />
                <p className="text-right text-[11px] font-mono tabular-nums text-muted-foreground">
                  {note.length}/{MAX_NOTE}
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={closePeriod.isPending} className="min-h-11">
            Cancel
          </Button>
          <Button onClick={handleClose} disabled={!canConfirm} className="rounded-xl font-bold min-h-11">
            {closePeriod.isPending ? 'Closing…' : 'Close period'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
