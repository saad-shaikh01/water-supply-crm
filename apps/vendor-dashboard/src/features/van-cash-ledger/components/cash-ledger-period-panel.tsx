'use client';

import { useState } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { AlertTriangle, CalendarRange, Lock, RefreshCw, Unlock } from 'lucide-react';
import {
  Badge, Button, Card, CardContent, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, cn,
} from '@water-supply-crm/ui';
import { useCashLedgerPeriods } from '../hooks/use-cash-ledger-periods';
import type { CashLedgerPeriodInfo } from '../api/van-cash-ledger.api';
import { fmtDateTime } from '../format';
import { ClosePeriodDialog } from './close-period-dialog';
import { ReopenPeriodDialog } from './reopen-period-dialog';
import { PeriodDriftChip, balanceText, ymdLong } from './period-drift-chip';

interface CashLedgerPeriodPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** "12 Sep" in the vendor timezone. */
const fmtShortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Karachi' });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function PeriodCard({
  period,
  canClose,
  onClose,
  onReopen,
  onView,
}: {
  period: CashLedgerPeriodInfo;
  canClose: boolean;
  onClose: (label: string) => void;
  onReopen: (label: string) => void;
  onView: (period: CashLedgerPeriodInfo) => void;
}) {
  const closed = period.status === 'CLOSED';
  const showClose = canClose && !closed && period.hasEnded;
  const showNotEnded = canClose && !closed && !period.hasEnded;
  const showReopen = canClose && period.canReopen;

  return (
    <Card className="bg-card/50 border-border/40 rounded-2xl">
      <CardContent className="p-3.5 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-black leading-tight">{period.displayLabel}</h3>
            <p className="text-[11px] text-muted-foreground">
              {ymdLong(period.firstDay)} → {ymdLong(period.lastDay)}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
            {period.isCurrent && <Badge variant="info">Current</Badge>}
            {closed ? (
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" aria-hidden />
                Closed
              </Badge>
            ) : (
              <Badge variant="success" className="gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                Open
              </Badge>
            )}
          </div>
        </div>

        {closed ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              Closed{period.closedByName ? <> by <span className="font-semibold text-foreground">{period.closedByName}</span></> : null}
              {period.closedAt ? ` · ${fmtDateTime(period.closedAt)}` : ''}
            </p>
            {period.closeNote?.trim() && (
              <p className="italic break-words">&ldquo;{period.closeNote.trim()}&rdquo;</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Balance now{' '}
            <span className="font-mono tabular-nums font-bold text-foreground">{balanceText(period.liveClosingBalance)}</span>
          </p>
        )}

        {period.reopenCount > 0 && (
          <p className="text-xs text-muted-foreground break-words">
            <Unlock className="inline h-3 w-3 mr-1 -mt-0.5" aria-hidden />
            Reopened {period.reopenCount > 1 ? `${period.reopenCount}× · last ` : ''}
            {period.reopenedByName ? <>by <span className="font-semibold text-foreground">{period.reopenedByName}</span></> : null}
            {period.reopenedAt ? ` · ${fmtDateTime(period.reopenedAt)}` : ''}
            {period.reopenReason?.trim() ? <> — &ldquo;{period.reopenReason.trim()}&rdquo;</> : null}
          </p>
        )}

        {period.overrideCount > 0 && (
          <p className="flex items-start gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
            <span>
              {plural(period.overrideCount, 'admin override')}
              {period.lastOverrideAt ? `, last ${fmtShortDay(period.lastOverrideAt)}` : ''}
            </span>
          </p>
        )}

        {closed && (
          <PeriodDriftChip
            closingBalance={period.closingBalance}
            liveClosingBalance={period.liveClosingBalance}
            drift={period.drift}
          />
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {showClose && (
            <Button
              size="sm"
              onClick={() => onClose(period.label)}
              className="min-h-11 sm:min-h-9 rounded-full px-4 text-xs font-bold gap-1.5"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Close period
            </Button>
          )}
          {showReopen && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReopen(period.label)}
              className="min-h-11 sm:min-h-9 rounded-full px-4 text-xs font-bold gap-1.5"
            >
              <Unlock className="h-3.5 w-3.5" aria-hidden />
              Reopen
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onView(period)}
            className="min-h-11 sm:min-h-9 rounded-full px-3 text-xs font-bold gap-1.5"
            aria-label={`View ${period.displayLabel} in the ledger`}
          >
            <CalendarRange className="h-3.5 w-3.5" aria-hidden />
            View in ledger
          </Button>
          {showNotEnded && (
            <p className="text-[11px] text-muted-foreground">Can be closed after {ymdLong(period.lastDay)}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Right-hand sheet listing the accounting periods (newest first) with close / reopen / view actions. */
export function CashLedgerPeriodPanel({ open, onOpenChange }: CashLedgerPeriodPanelProps) {
  const query = useCashLedgerPeriods();
  const [, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [, setTo] = useQueryState('to', parseAsString.withDefault(''));
  const [closeLabel, setCloseLabel] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenLabel, setReopenLabel] = useState<string | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);

  const data = query.data;
  const canClose = !!data?.permissions.canClose;

  const viewInLedger = (p: CashLedgerPeriodInfo) => {
    void setFrom(p.firstDay, { history: 'push' });
    void setTo(p.lastDay, { history: 'push' });
    onOpenChange(false);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle className="text-xl font-black">Accounting periods</SheetTitle>
            <SheetDescription className="text-xs leading-relaxed">
              Months close in order once ended and nothing is pending. Edits into a closed month need an admin
              override with a reason. The ledger balance always stays live.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto space-y-3 py-2" aria-live="polite" aria-busy={query.isLoading}>
            {query.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
            ) : query.isError && !data ? (
              <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3">
                <p className="text-sm font-semibold text-destructive">Couldn&apos;t load the accounting periods.</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void query.refetch()}
                  disabled={query.isFetching}
                  className="min-h-11 sm:min-h-9 rounded-full gap-1.5"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', query.isFetching && 'animate-spin')} aria-hidden />
                  Retry
                </Button>
              </div>
            ) : !data || data.periods.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                No periods yet. They appear once the ledger has activity.
              </p>
            ) : (
              data.periods.map((p) => (
                <PeriodCard
                  key={p.label}
                  period={p}
                  canClose={canClose}
                  onClose={(label) => { setCloseLabel(label); setCloseOpen(true); }}
                  onReopen={(label) => { setReopenLabel(label); setReopenOpen(true); }}
                  onView={viewInLedger}
                />
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ClosePeriodDialog label={closeLabel} open={closeOpen} onOpenChange={setCloseOpen} />
      <ReopenPeriodDialog label={reopenLabel} open={reopenOpen} onOpenChange={setReopenOpen} />
    </>
  );
}
