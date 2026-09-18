'use client';

import type { ReactNode } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Clock, Ban, List, Pencil } from 'lucide-react';
import { useQueryState, parseAsString } from 'nuqs';
import {
  Badge, Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, cn,
} from '@water-supply-crm/ui';
import type { CashLedgerPeriodRow, CashLedgerRow, CashLedgerSummaryGroup } from '../api/van-cash-ledger.api';
import { cashLedgerBucketMeta, cashLedgerRowMeta } from '../constants';
import { fmtDate, fmtDateTime, signedMoney } from '../format';
import {
  PERIOD_ENTRIES_LIMIT, toDayStatement, useCashLedgerPeriodEntries,
} from '../hooks/use-cash-ledger-daily-summary';
import { useCashLedgerView } from '../hooks/use-cash-ledger-view';
import { formatYmdShort } from '../../../lib/date-pkt';
import { DayStatement } from './day-statement';
import { RowStateChips, StateChip } from './timeline-row';
import { InlineRetry, describeError } from './timeline-states';
import {
  ENTRY_PARAM, encodeEntryKey, entryKeyOf, rowAmountLabel, rowDirection, rowShownAmount, type EntryKey,
} from './timeline-format';

const DIRECTION_ICON = { IN: ArrowDownLeft, OUT: ArrowUpRight, TRANSFER: ArrowLeftRight } as const;
const UNIT_LABEL: Record<CashLedgerSummaryGroup, string> = { day: 'day', week: 'week', month: 'month' };

interface CashLedgerDayDrawerProps {
  row: CashLedgerPeriodRow | null;
  group: CashLedgerSummaryGroup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** "6 – 12 Jul 2026" for a multi-day bucket; nothing for a single day (the title already says it). */
function boundsLabel(from: string, to: string): string | null {
  if (from === to) return null;
  const year = to.slice(0, 4);
  return `${formatYmdShort(from)}${from.slice(0, 4) !== year ? ` ${from.slice(0, 4)}` : ''} – ${formatYmdShort(to)} ${year}`;
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{children}</h3>
      {aside}
    </div>
  );
}

/** One compact, read-only entry. Clicking it opens the unified entry drawer on the timeline. */
function DrawerEntry({
  entry, showDate, onOpen,
}: { entry: CashLedgerRow; showDate: boolean; onOpen: (entry: CashLedgerRow) => void }) {
  const rowMeta = cashLedgerRowMeta(entry.type);
  const bucketMeta = cashLedgerBucketMeta(entry.bucket);
  const direction = rowDirection(entry);
  const DirIcon = DIRECTION_ICON[direction];
  const tone = bucketMeta?.text ?? rowMeta.amountClass;
  const shown = rowShownAmount(entry);
  const voided = !!entry.isVoided;
  const activate = () => onOpen(entry);

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open in timeline: ${entry.title}`}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        }}
        className={cn(
          'transition-colors flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl border border-border/40 bg-card/40 p-2.5 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          voided && 'opacity-80',
        )}
      >
        <span
          className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted/40', tone)}
          title={direction === 'IN' ? 'Cash in' : direction === 'TRANSFER' ? 'Transfer out' : 'Cash out'}
        >
          <DirIcon className="h-4 w-4" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {bucketMeta ? (
              <Badge variant="outline" className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', bucketMeta.chip)}>
                {bucketMeta.label}
              </Badge>
            ) : (
              <Badge variant="outline" className={cn('rounded-full border-transparent px-2 py-0.5 text-[10px] font-bold', rowMeta.color)}>
                {rowMeta.label}
              </Badge>
            )}
            {showDate && <span className="text-[10px] font-semibold text-muted-foreground">{fmtDate(entry.date)}</span>}
            <p
              className={cn('w-full min-w-0 truncate text-xs font-semibold', voided && 'text-muted-foreground line-through')}
              title={entry.title}
            >
              {entry.title}
            </p>
          </div>
          {(entry.createdAt || entry.isEdited || voided || (entry.lagDays ?? 0) !== 0) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
              {entry.createdAt && (
                <span>
                  Recorded {fmtDateTime(entry.createdAt)}
                  {entry.recordedByName ? ` · ${entry.recordedByName}` : ''}
                </span>
              )}
              <RowStateChips row={entry} />
            </div>
          )}
        </div>

        <p
          className={cn(
            'shrink-0 whitespace-nowrap text-right font-mono text-sm font-black tabular-nums',
            tone,
            voided && 'line-through opacity-60',
          )}
        >
          <span aria-hidden>{signedMoney(shown)}</span>
          <span className="sr-only">{rowAmountLabel(entry, shown)}</span>
        </p>
      </div>
    </li>
  );
}

/**
 * Day (or week / month) drawer for the table view (spec §4.8): the bucket's full
 * reconciliation statement, a memo strip, and the entries dated inside it.
 * Everything actionable lives on the timeline — this drawer only reads and
 * navigates: "Open in timeline" (or clicking an entry) sets from / to / view
 * (and `entry`) and closes the drawer.
 */
export function CashLedgerDayDrawer({ row, group, open, onOpenChange }: CashLedgerDayDrawerProps) {
  const [, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [, setTo] = useQueryState('to', parseAsString.withDefault(''));
  const [, setEntry] = useQueryState(ENTRY_PARAM, parseAsString);
  const [, setView] = useCashLedgerView();

  const entries = useCashLedgerPeriodEntries(row, open);
  const rows = entries.data?.data ?? [];
  const total = entries.data?.meta?.total ?? 0;
  const unit = UNIT_LABEL[group];

  const goToTimeline = (key: EntryKey | null) => {
    if (!row) return;
    // The bucket's own (clamped) bounds — same date window the table row covered. nuqs batches these into one URL update.
    void setFrom(row.from, { history: 'push' });
    void setTo(row.to, { history: 'push' });
    void setEntry(key ? encodeEntryKey(key) : null, { history: 'push' });
    setView('timeline');
    onOpenChange(false);
  };

  const bounds = row ? boundsLabel(row.from, row.to) : null;
  const hasMemo = !!row && (row.pendingCount > 0 || row.lateCount > 0 || row.editedCount > 0 || row.voidedCount > 0);

  let entriesBody: ReactNode;
  if (entries.isLoading) {
    entriesBody = (
      <div className="space-y-2" aria-busy="true" aria-label="Loading entries">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  } else if (entries.isError) {
    entriesBody = (
      <InlineRetry
        label={describeError(entries.error).message}
        onRetry={() => void entries.refetch()}
        retrying={entries.isFetching}
      />
    );
  } else if (rows.length === 0) {
    entriesBody = (
      <p className="rounded-xl border border-border/40 bg-card/30 px-4 py-6 text-center text-xs text-muted-foreground">
        No entries are dated in this {unit}.
      </p>
    );
  } else {
    entriesBody = (
      <ul className={cn('space-y-2', entries.isFetching && 'opacity-60')}>
        {rows.map((entry) => (
          <DrawerEntry
            key={`${entry.type}:${entry.id}`}
            entry={entry}
            showDate={group !== 'day'}
            onOpen={(e) => goToTimeline(entryKeyOf(e))}
          />
        ))}
      </ul>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:w-[560px] sm:max-w-[560px]"
        // The body scrolls, not the sheet — keeps the header pinned.
        style={{ overflowY: 'hidden' }}
      >
        <SheetHeader className="space-y-2 border-b border-border/50 px-5 pb-4 pr-12 pt-5 text-left">
          <SheetTitle className="text-base font-bold leading-snug">{row?.label ?? 'Cash ledger'}</SheetTitle>
          <SheetDescription className="text-xs">
            {bounds ? `${bounds} · ` : ''}
            {group === 'day' ? 'Day statement and entries' : `Aggregated ${unit} statement and entries`}
          </SheetDescription>
          <div>
            <Button
              variant="outline"
              size="sm"
              className="h-11 gap-1.5 sm:h-9"
              disabled={!row}
              onClick={() => goToTimeline(null)}
            >
              <List className="h-4 w-4" aria-hidden />
              Open in timeline
            </Button>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {row && (
            <>
              <section aria-label="Statement">
                <SectionTitle>Statement</SectionTitle>
                <DayStatement statement={toDayStatement(row)} />
                {group !== 'day' && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Opening is the cash brought into the first day; every other line is summed across the {unit}.
                  </p>
                )}
              </section>

              <section aria-label="Memo">
                <SectionTitle>Memo</SectionTitle>
                {hasMemo ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {row.pendingCount > 0 && (
                      <StateChip
                        className="border-transparent bg-amber-500/10 text-amber-500"
                        title="Handovers / owner transfers waiting for approval — not counted in the balance yet"
                      >
                        {row.pendingCount} awaiting approval
                      </StateChip>
                    )}
                    {row.lateCount > 0 && (
                      <StateChip
                        icon={Clock}
                        title="Dated in this period but recorded on a later day"
                      >
                        {row.lateCount} {row.lateCount === 1 ? 'entry' : 'entries'} recorded after this {unit}
                      </StateChip>
                    )}
                    {row.editedCount > 0 && (
                      <StateChip icon={Pencil}>{row.editedCount} edited</StateChip>
                    )}
                    {row.voidedCount > 0 && (
                      <StateChip icon={Ban} className="border-destructive/50 text-destructive">
                        {row.voidedCount} voided
                      </StateChip>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Nothing pending, late, edited or voided.</p>
                )}
              </section>

              <section aria-label="Entries">
                <SectionTitle
                  aside={
                    entries.data ? (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {total.toLocaleString('en-PK')} {total === 1 ? 'entry' : 'entries'}
                      </span>
                    ) : null
                  }
                >
                  Entries
                </SectionTitle>
                {entriesBody}
                {total > PERIOD_ENTRIES_LIMIT && (
                  <div className="mt-3 flex flex-col items-center gap-1.5 text-center">
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      Showing {rows.length.toLocaleString('en-PK')} of {total.toLocaleString('en-PK')}
                    </p>
                    <Button variant="outline" size="sm" className="h-11 gap-1.5 sm:h-9" onClick={() => goToTimeline(null)}>
                      <List className="h-4 w-4" aria-hidden />
                      See all {total.toLocaleString('en-PK')} in timeline
                    </Button>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
