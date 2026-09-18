'use client';

import { AlertTriangle, CalendarRange, Inbox, SearchX, ShieldAlert, FilterX } from 'lucide-react';
import { Button, Card, CardContent, Skeleton } from '@water-supply-crm/ui';
import { CashLedgerFilterChips } from './cash-ledger-filter-chips';

/** Row-shaped skeleton used both for the first load and while a further page is loading. */
export function TimelineRowSkeleton() {
  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 p-3 flex items-start gap-3">
      <Skeleton className="h-7 w-7 rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex gap-2">
          <Skeleton className="h-4 w-20 rounded-full" />
          <Skeleton className="h-4 w-14 rounded-full" />
        </div>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="space-y-2 shrink-0 flex flex-col items-end">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-14 hidden sm:block" />
      </div>
    </div>
  );
}

/** First-load skeleton: two day groups (header bar + three rows each). */
export function TimelineSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading cash ledger">
      {[0, 1].map((g) => (
        <div key={g} className="space-y-2">
          <Skeleton className="h-12 w-full rounded-2xl" />
          {[0, 1, 2].map((r) => (
            <TimelineRowSkeleton key={r} />
          ))}
        </div>
      ))}
    </div>
  );
}

interface EmptyProps {
  hasVanFilter: boolean;
  onShowLastMonth: () => void;
  onClearVan: () => void;
}

/** Calm empty state — never a blank area. */
export function TimelineEmpty({ hasVanFilter, onShowLastMonth, onClearVan }: EmptyProps) {
  return (
    <Card className="bg-card/30 border-border/40 rounded-2xl">
      <CardContent className="p-8 sm:p-10 flex flex-col items-center justify-center gap-4 text-center">
        <div className="p-5 rounded-2xl bg-white/[0.01] border border-border">
          <Inbox className="h-8 w-8 text-muted-foreground/50" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-bold text-foreground">No cash movements in this period</p>
          <p className="text-xs text-muted-foreground">
            Nothing was recorded for the selected dates{hasVanFilter ? ' and van' : ''}. Try another range.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button variant="outline" size="sm" className="h-11 sm:h-9 gap-2" onClick={onShowLastMonth}>
            <CalendarRange className="h-4 w-4" aria-hidden />
            Show last month
          </Button>
          {hasVanFilter && (
            <Button variant="outline" size="sm" className="h-11 sm:h-9 gap-2" onClick={onClearVan}>
              <FilterX className="h-4 w-4" aria-hidden />
              Clear van filter
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Zero rows while entry filters are active — distinct from "no cash movements
 * in this period" (the range itself is empty). Names the active filters as
 * removable chips and offers one-click recovery.
 */
export function TimelineFilteredEmpty({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <Card className="bg-card/30 border-border/40 rounded-2xl">
      <CardContent className="p-8 sm:p-10 flex flex-col items-center justify-center gap-4 text-center">
        <div className="p-5 rounded-2xl bg-white/[0.01] border border-border">
          <SearchX className="h-8 w-8 text-muted-foreground/50" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-bold text-foreground">No entries match your filters</p>
          <p className="text-xs text-muted-foreground">
            Nothing in the selected dates matched. Remove a filter below, or clear them all.
          </p>
        </div>
        <CashLedgerFilterChips showClearAll={false} className="flex-wrap justify-center overflow-visible" />
        <Button variant="outline" size="sm" className="h-11 sm:h-9 gap-2" onClick={onClearFilters}>
          <FilterX className="h-4 w-4" aria-hidden />
          Clear filters
        </Button>
      </CardContent>
    </Card>
  );
}

export interface TimelineErrorInfo {
  status: number | null;
  message: string;
  requestId: string | null;
}

/** Pulls status / message / request id out of an axios-style error without depending on axios types. */
export function describeError(error: unknown): TimelineErrorInfo {
  const e = error as {
    message?: string;
    response?: {
      status?: number;
      data?: { message?: string | string[]; requestId?: string };
      headers?: Record<string, unknown>;
    };
  } | null;
  const raw = e?.response?.data?.message;
  const message =
    (Array.isArray(raw) ? raw.join(', ') : raw) || e?.message || 'Something went wrong while loading the ledger.';
  const headerId = e?.response?.headers?.['x-request-id'];
  const requestId =
    (typeof headerId === 'string' && headerId) || e?.response?.data?.requestId || null;
  return { status: e?.response?.status ?? null, message, requestId };
}

interface ErrorProps {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}

/** Full-area error / 403 panel (used when there is no data to fall back to). */
export function TimelineError({ error, onRetry, retrying }: ErrorProps) {
  const info = describeError(error);

  if (info.status === 403) {
    return (
      <Card className="bg-card/30 border-border/40 rounded-2xl" role="alert">
        <CardContent className="p-8 sm:p-10 flex flex-col items-center gap-3 text-center">
          <ShieldAlert className="h-8 w-8 text-muted-foreground/60" aria-hidden />
          <p className="text-sm font-bold">You don&apos;t have access to this ledger</p>
          <p className="text-xs text-muted-foreground">Ask an administrator to grant you Cash Ledger access.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-destructive/5 border-destructive/30 rounded-2xl" role="alert">
      <CardContent className="p-6 sm:p-8 flex flex-col items-center gap-3 text-center">
        <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden />
        <p className="text-sm font-bold">Couldn&apos;t load the cash ledger</p>
        <p className="text-xs text-muted-foreground max-w-md break-words">{info.message}</p>
        {info.requestId && (
          <p className="text-[10px] font-mono text-muted-foreground/70 break-all">Request ID: {info.requestId}</p>
        )}
        <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={onRetry} disabled={retrying}>
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Slim inline banner for a failed background refresh / next-page fetch while data is still on screen. */
export function InlineRetry({
  label, onRetry, retrying,
}: { label: string; onRetry: () => void; retrying?: boolean }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2"
      role="alert"
    >
      <span className="text-xs text-muted-foreground min-w-0">{label}</span>
      <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={onRetry} disabled={retrying}>
        {retrying ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  );
}
