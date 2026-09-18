'use client';

import {
  AlertTriangle, BadgeCheck, Ban, Circle, Lock, Pencil, PencilLine, Plus, RefreshCw, Undo2, type LucideIcon,
} from 'lucide-react';
import { Button, Skeleton, cn } from '@water-supply-crm/ui';
import type { CashLedgerHistoryAction, CashLedgerHistoryEvent } from '../api/van-cash-ledger.api';
import { useEntryHistory } from '../hooks/use-van-cash-ledger';
import { fmtDateTime } from '../format';
import { HistoryChangeDiff } from './history-change-diff';

/**
 * Per-action icon, label and STATE colour. Deliberately not the money colours
 * (a colour never carries the meaning alone — every event also has an icon and a word).
 */
const ACTION_META: Record<CashLedgerHistoryAction, { label: string; icon: LucideIcon; tone: string }> = {
  CREATED: { label: 'Created', icon: Plus, tone: 'border-border bg-muted/40 text-muted-foreground' },
  UPDATED: { label: 'Edited', icon: Pencil, tone: 'border-sky-500/40 bg-sky-500/10 text-sky-500' },
  APPROVED: { label: 'Approved', icon: BadgeCheck, tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' },
  CORRECTED: { label: 'Corrected', icon: PencilLine, tone: 'border-amber-500/40 bg-amber-500/10 text-amber-500' },
  VOIDED: { label: 'Voided', icon: Ban, tone: 'border-destructive/40 bg-destructive/10 text-destructive' },
  REVERSED: { label: 'Reversed', icon: Undo2, tone: 'border-dashed border-destructive/40 bg-transparent text-destructive' },
  OTHER: { label: 'Activity', icon: Circle, tone: 'border-border bg-muted/40 text-muted-foreground' },
};

/** Axios-shaped errors: 403 / 404 mean "not yours / not there", everything else is a retryable failure. */
export function isEntryUnavailableError(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 403 || status === 404;
}

/** Calm panel for an entry the user can't (or can no longer) open — never a red error. */
export function EntryUnavailablePanel() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center" role="status">
      <div className="rounded-2xl border border-border bg-muted/20 p-4">
        <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <p className="text-sm font-bold text-foreground">You can&apos;t view this entry</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        It may have been removed, or your role doesn&apos;t have access to it. Check the link or open the entry from the ledger list.
      </p>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading history">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryEvent({ event, isLast }: { event: CashLedgerHistoryEvent; isLast: boolean }) {
  const meta = ACTION_META[event.action] ?? ACTION_META.OTHER;
  const Icon = meta.icon;
  const fullTime = new Date(event.at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' });

  return (
    <li className="relative pl-11 pb-6 last:pb-0">
      {!isLast && <span className="absolute left-[15px] top-9 bottom-0 w-px bg-border/70" aria-hidden />}
      <span className={cn('absolute left-0 top-0 grid h-8 w-8 place-items-center rounded-full border', meta.tone)}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>

      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
          <span className="font-bold text-foreground">{meta.label}</span>
          {event.actorName && <span className="text-muted-foreground">by {event.actorName}</span>}
        </p>
        <time dateTime={event.at} title={fullTime} className="block text-[11px] text-muted-foreground tabular-nums">
          {fmtDateTime(event.at)}
        </time>

        {event.summary && <p className="mt-1.5 text-xs text-foreground/90">{event.summary}</p>}

        {event.reason && (
          <blockquote className="mt-2 rounded-r-xl border-l-2 border-border bg-muted/20 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Reason</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-xs italic text-foreground/90">{event.reason}</p>
          </blockquote>
        )}

        <HistoryChangeDiff changes={event.changes ?? []} />
      </div>
    </li>
  );
}

interface EntryHistoryProps {
  sourceType: string | null;
  sourceRecordId: string | null;
  /** Fetch gate — the drawer passes `open` so History is warm before its tab is selected. */
  enabled: boolean;
}

/** History tab: the entry's audit trail, newest first. */
export function EntryHistory({ sourceType, sourceRecordId, enabled }: EntryHistoryProps) {
  const { data, isLoading, isError, error, refetch, isFetching } = useEntryHistory(sourceType, sourceRecordId, enabled);

  if (isLoading) return <HistorySkeleton />;

  if (isError) {
    if (isEntryUnavailableError(error)) return <EntryUnavailablePanel />;
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-5 text-center" role="alert">
        <AlertTriangle className="mx-auto h-5 w-5 text-destructive" aria-hidden />
        <p className="mt-2 text-sm font-bold">Couldn&apos;t load this entry&apos;s history</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Check your connection and try again.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 h-11 sm:h-9 gap-2"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} aria-hidden />
          Retry
        </Button>
      </div>
    );
  }

  const events = data?.events ?? [];

  return (
    <div>
      {events.length === 0 ? (
        <p className="rounded-2xl border border-border/40 bg-card/30 px-4 py-6 text-center text-xs text-muted-foreground">
          No recorded changes yet — this entry was created before change tracking began.
        </p>
      ) : (
        <ol className="m-0 list-none p-0" aria-label="Entry history, newest first">
          {events.map((event, i) => (
            <HistoryEvent key={event.id} event={event} isLast={i === events.length - 1} />
          ))}
        </ol>
      )}
      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        History is read from the audit log and can&apos;t be edited.
      </p>
    </div>
  );
}
