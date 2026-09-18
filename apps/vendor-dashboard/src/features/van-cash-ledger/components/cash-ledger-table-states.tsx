'use client';

import { CalendarRange, CalendarPlus, Info, Inbox } from 'lucide-react';
import { Button, Card, CardContent, Skeleton } from '@water-supply-crm/ui';
import { TimelineError } from './timeline-states';

const SKELETON_ROWS = 8;
/** Per-column widths for the skeleton rows (first = Date, rest = numeric cells). */
const SKELETON_COLS = ['w-32', 'w-16', 'w-14', 'w-14', 'w-14', 'w-14', 'w-14', 'w-14', 'w-16', 'w-16'];

/** First-load skeleton shaped like the table (header + 8 rows), or like the mobile card list. */
export function CashLedgerTableSkeleton({ mobile }: { mobile?: boolean }) {
  if (mobile) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading cash ledger table">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-border/40 bg-card/50 p-3">
            <Skeleton className="h-4 w-40" />
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-2xl border border-border/40 bg-card/30"
      aria-busy="true"
      aria-label="Loading cash ledger table"
    >
      <div className="flex items-center gap-4 border-b border-border/40 bg-muted/30 px-3 py-3">
        {SKELETON_COLS.map((w, i) => (
          <Skeleton key={i} className={`h-3 ${w} shrink-0 ${i === 0 ? '' : 'ml-auto'}`} />
        ))}
      </div>
      {Array.from({ length: SKELETON_ROWS }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-border/30 px-3 py-3.5 last:border-b-0">
          {SKELETON_COLS.map((w, i) => (
            <Skeleton key={i} className={`h-4 ${w} shrink-0 ${i === 0 ? '' : 'ml-auto'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

interface EmptyProps {
  includeEmpty: boolean;
  hasVanFilter: boolean;
  onShowEmptyDays: () => void;
  onShowLastMonth: () => void;
}

/** "No activity" — never a blank area. Offers the two escapes: reveal empty days, or look at last month. */
export function CashLedgerTableEmpty({ includeEmpty, hasVanFilter, onShowEmptyDays, onShowLastMonth }: EmptyProps) {
  return (
    <Card className="rounded-2xl border-border/40 bg-card/30">
      <CardContent className="flex flex-col items-center justify-center gap-4 p-8 text-center sm:p-10">
        <div className="rounded-2xl border border-border bg-white/[0.01] p-5">
          <Inbox className="h-8 w-8 text-muted-foreground/50" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-bold text-foreground">No activity in this period</p>
          <p className="text-xs text-muted-foreground">
            Nothing was recorded for the selected dates{hasVanFilter ? ' and van' : ''}. Try another range.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {!includeEmpty && (
            <Button variant="outline" size="sm" className="h-11 gap-2 sm:h-9" onClick={onShowEmptyDays}>
              <CalendarPlus className="h-4 w-4" aria-hidden />
              Show empty days
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-11 gap-2 sm:h-9" onClick={onShowLastMonth}>
            <CalendarRange className="h-4 w-4" aria-hidden />
            Show last month
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Error card with message + Retry, and the 403 "no access" panel — shared with the timeline. */
export function CashLedgerTableError({
  error, onRetry, retrying,
}: { error: unknown; onRetry: () => void; retrying?: boolean }) {
  return <TimelineError error={error} onRetry={onRetry} retrying={retrying} />;
}

/** Shown when the server dropped the oldest rows because the range exceeded its 366-row cap. */
export function CashLedgerTruncatedNotice() {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-500"
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>Showing the most recent 366 rows — narrow the date range or group by week/month.</span>
    </div>
  );
}
