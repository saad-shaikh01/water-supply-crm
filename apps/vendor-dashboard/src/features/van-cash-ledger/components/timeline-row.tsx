'use client';

import { useState, type ReactNode } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Paperclip, History, CalendarClock, Pencil, Ban, ChevronRight,
  ChevronDown, Scale, Lock, Undo2,
} from 'lucide-react';
import { Badge, Card, cn } from '@water-supply-crm/ui';
import type { CashLedgerRow } from '../api/van-cash-ledger.api';
import { cashLedgerBucketMeta, cashLedgerRowMeta } from '../constants';
import { fmtDate, fmtDateTime, money, signedMoney } from '../format';
import {
  balanceText, balanceTone, closedPeriodTitle, encodeEntryKey, entryKeyOf, rowAmountLabel, rowDirection,
  rowShownAmount,
} from './timeline-format';
import {
  RowActionsMenu, type RowActionFlags, type RowActionHandlers,
} from './row-actions-menu';
import { SheetCashBreakdown } from './sheet-cash-breakdown';

const DIRECTION_ICON = { IN: ArrowDownLeft, OUT: ArrowUpRight, TRANSFER: ArrowLeftRight } as const;

/** Neutral vocabulary for STATE chips (never a bucket colour). Sentence case, outlined. */
export function StateChip({
  className, title, icon: Icon, children,
}: { className?: string; title?: string; icon?: typeof History; children: ReactNode }) {
  return (
    <Badge
      variant="outline"
      title={title}
      className={cn(
        'gap-1 px-1.5 py-0 text-[10px] font-semibold normal-case tracking-normal rounded-full text-muted-foreground',
        className,
      )}
    >
      {Icon && <Icon className="h-2.5 w-2.5 shrink-0" aria-hidden />}
      {children}
    </Badge>
  );
}

/**
 * The neutral STATE chips of a row (backdated / future, edited, pending, correction, voided, variance,
 * closed period, "for <date>" redirect).
 * Shared by the timeline row and the unified detail drawer's header so the two never disagree.
 */
export function RowStateChips({ row }: { row: CashLedgerRow }) {
  const isCashInLike = row.type === 'CASH_IN' || row.type === 'CASH_IN_CORRECTION';
  const isPending = isCashInLike && row.status === 'PENDING';
  const voided = !!row.isVoided;
  const lag = row.lagDays ?? 0;
  const recordedBy = row.recordedByName ?? null;
  const hasVariance = isCashInLike && row.variance != null && row.variance !== 0;

  return (
    <>
      {lag > 0 && row.createdAt && (
        <StateChip
          icon={History}
          className={lag >= 7 ? 'border-amber-500/50 text-amber-500' : undefined}
          title={`Belongs to ${fmtDate(row.date)} · added ${fmtDateTime(row.createdAt)}${recordedBy ? ` by ${recordedBy}` : ''} (${lag} day${lag === 1 ? '' : 's'} later)`}
        >
          Backdated · {lag}d
        </StateChip>
      )}
      {lag < 0 && row.createdAt && (
        <StateChip
          icon={CalendarClock}
          title={`Belongs to ${fmtDate(row.date)} · added ${fmtDateTime(row.createdAt)}${recordedBy ? ` by ${recordedBy}` : ''} (${Math.abs(lag)} day${lag === -1 ? '' : 's'} earlier)`}
        >
          Future
        </StateChip>
      )}
      {row.isEdited && (
        <StateChip
          icon={Pencil}
          title={row.lastEditedAt ? `Edited ${fmtDateTime(row.lastEditedAt)}` : 'Edited after it was recorded'}
        >
          Edited
        </StateChip>
      )}
      {isPending && (
        <StateChip className="border-transparent bg-amber-500/10 text-amber-500">Pending</StateChip>
      )}
      {row.type === 'CASH_IN_CORRECTION' && (
        <StateChip className="border-transparent bg-amber-500/10 text-amber-500">Correction</StateChip>
      )}
      {voided && (
        <StateChip
          icon={Ban}
          className="border-destructive/50 text-destructive"
          title={[
            row.voidedByName ? `Voided by ${row.voidedByName}` : 'Voided',
            row.voidedAt ? fmtDateTime(row.voidedAt) : null,
            row.voidReason ? `“${row.voidReason}”` : null,
          ].filter(Boolean).join(' · ')}
        >
          Voided
        </StateChip>
      )}
      {row.periodClosed && (
        <StateChip icon={Lock} className="bg-muted/40" title={closedPeriodTitle(row)}>
          Closed period
        </StateChip>
      )}
      {row.relatesToDate && (
        <StateChip
          icon={Undo2}
          title={`Belongs to ${fmtDate(row.relatesToDate)} — a closed period. Counted in the current period.`}
        >
          For {fmtDate(row.relatesToDate)}
        </StateChip>
      )}
      {hasVariance && (
        <StateChip
          icon={Scale}
          title={`Sheet said ${money(row.expectedAmount)}; approved ${money(row.amount)}`}
        >
          <span className="font-mono">{signedMoney(row.variance)}</span> vs sheet
        </StateChip>
      )}
    </>
  );
}

interface TimelineRowProps {
  row: CashLedgerRow;
  flags: RowActionFlags;
  handlers: RowActionHandlers;
}

export function TimelineRow({ row, flags, handlers }: TimelineRowProps) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const rowMeta = cashLedgerRowMeta(row.type);
  const bucketMeta = cashLedgerBucketMeta(row.bucket);
  const direction = rowDirection(row);
  const DirIcon = DIRECTION_ICON[direction];
  const tone = bucketMeta?.text ?? rowMeta.amountClass;

  const isCashInLike = row.type === 'CASH_IN' || row.type === 'CASH_IN_CORRECTION';
  const isPending = isCashInLike && row.status === 'PENDING';
  const voided = !!row.isVoided;
  const lag = row.lagDays ?? 0;
  const recordedBy = row.recordedByName ?? null;

  // A voided row folds in as 0 — still show what it WAS, struck through, so the audit trail reads.
  const shownAmount = rowShownAmount(row);
  const amountLabel = rowAmountLabel(row, shownAmount);

  const authorAddsInfo = !!row.submittedByName && row.submittedByName !== recordedBy && row.submittedByName !== row.employeeName;
  const notesExcerpt = row.notes ? (row.notes.length > 60 ? `${row.notes.slice(0, 60)}…` : row.notes) : null;
  const showRef = !!row.reference && !row.sourceBadge?.includes(row.reference);

  const detailBits: ReactNode[] = [];
  if (row.employeeName) detailBits.push(<span key="emp" className="font-semibold text-foreground/80">{row.employeeName}</span>);
  if (authorAddsInfo) detailBits.push(<span key="by">by {row.submittedByName}</span>);
  if (row.approvedByName) detailBits.push(<span key="appr">approved by {row.approvedByName}</span>);
  if (notesExcerpt) detailBits.push(<span key="notes" title={row.notes ?? undefined} className="truncate max-w-full">{notesExcerpt}</span>);
  if (showRef) detailBits.push(<span key="ref" className="font-mono">Ref {row.reference}</span>);
  if (row.hasAttachment) {
    detailBits.push(
      <span key="att" className="inline-flex items-center" title="Has an attachment">
        <Paperclip className="h-3 w-3" aria-hidden />
        <span className="sr-only">Has an attachment</span>
      </span>,
    );
  }
  if (voided && row.voidReason) detailBits.push(<span key="void" className="truncate max-w-full">voided — {row.voidReason}</span>);
  if (flags.payrollHint) {
    detailBits.push(
      <span key="payroll" className="italic" title="Payroll settlements are managed on the Payroll page">
        Manage in Payroll
      </span>,
    );
  }

  const hasVariance = isCashInLike && row.variance != null && row.variance !== 0;
  const clickable = flags.viewDetails;

  const openDetails = () => handlers.onViewDetails(row);
  const entryKey = entryKeyOf(row);

  return (
    <Card
      className={cn('bg-card/50 border-border/40 rounded-2xl', voided && 'opacity-80')}
      // Lets the timeline scroll a deep-linked (`?entry=`) row into view.
      data-entry-key={entryKey ? encodeEntryKey(entryKey) : undefined}
    >
      <div className="flex items-start gap-1 pl-3 pr-2 sm:pr-3 py-3">
        <div
          className={cn(
            'flex flex-1 min-w-0 items-start gap-3 rounded-xl',
            clickable && 'cursor-pointer transition-colors hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          aria-label={clickable ? `View details and history: ${row.title}` : undefined}
          onClick={clickable ? openDetails : undefined}
          onKeyDown={
            clickable
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openDetails();
                  }
                }
              : undefined
          }
        >
          {/* Direction: icon + sign + label — never colour alone. */}
          <span
            className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted/40', tone)}
            title={direction === 'IN' ? 'Cash in' : direction === 'TRANSFER' ? 'Transfer out' : 'Cash out'}
          >
            <DirIcon className="h-4 w-4" aria-hidden />
          </span>

          <div className="flex-1 min-w-0">
            {/* Line 1 — chips, then the title (own line on mobile). */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              {bucketMeta ? (
                <Badge variant="outline" className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', bucketMeta.chip)}>
                  {bucketMeta.label}
                </Badge>
              ) : (
                <Badge variant="outline" className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border-transparent', rowMeta.color)}>
                  {rowMeta.label}
                </Badge>
              )}
              {row.sourceBadge && (
                <Badge variant="secondary" className="text-[10px] font-medium">{row.sourceBadge}</Badge>
              )}
              {row.vanPlateNumber && (
                <Badge variant="secondary" className="text-[10px] font-mono">{row.vanPlateNumber}</Badge>
              )}
              <p
                className={cn(
                  'w-full sm:w-auto sm:flex-1 min-w-0 truncate text-xs font-semibold',
                  voided && 'line-through text-muted-foreground',
                )}
                title={row.title}
              >
                {row.title}
              </p>
            </div>

            {/* Line 2 — who / what / reference. */}
            {detailBits.length > 0 && (
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground min-w-0">
                {detailBits.map((bit, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 min-w-0">
                    {i > 0 && <span aria-hidden>·</span>}
                    {bit}
                  </span>
                ))}
              </p>
            )}

            {/* Line 3 — recorded-at (the business date is implied by the day group) + state chips. Same-day rows stay quiet. */}
            {(row.createdAt || isPending || voided || row.isEdited || row.type === 'CASH_IN_CORRECTION' || hasVariance || lag !== 0 || row.periodClosed || !!row.relatesToDate) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                {row.createdAt && (
                  <span>
                    Recorded {fmtDateTime(row.createdAt)}
                    {recordedBy ? ` · ${recordedBy}` : ''}
                  </span>
                )}

                <RowStateChips row={row} />
              </div>
            )}
          </div>

          {/* Amount block — top-right; balance is desktop-only. */}
          <div className="shrink-0 text-right">
            <p
              className={cn(
                'font-mono font-black text-sm tabular-nums whitespace-nowrap',
                tone,
                voided && 'line-through opacity-60',
              )}
            >
              <span aria-hidden>{signedMoney(shownAmount)}</span>
              <span className="sr-only">{amountLabel}</span>
            </p>
            <p
              className="hidden sm:block mt-1 text-[10px] text-muted-foreground tabular-nums whitespace-nowrap"
              title="Running balance of the whole ledger after this entry — not filtered"
            >
              Balance after{' '}
              <span className={cn('font-bold', balanceTone(row.runningBalance) ?? 'text-foreground')}>
                {balanceText(row.runningBalance)}
              </span>
            </p>
          </div>
        </div>

        <RowActionsMenu
          row={row}
          flags={flags}
          handlers={handlers}
          breakdownExpanded={breakdownOpen}
          onToggleBreakdown={() => setBreakdownOpen((v) => !v)}
        />
      </div>

      {flags.breakdown && (
        <div className="-mt-1 pb-1 pl-[3.25rem]">
          <button
            type="button"
            aria-expanded={breakdownOpen}
            onClick={() => setBreakdownOpen((v) => !v)}
            className="inline-flex items-center gap-1 min-h-11 sm:min-h-6 -my-2.5 sm:my-0 pr-3 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            Cash breakdown
            {breakdownOpen ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
          </button>
        </div>
      )}
      {flags.breakdown && breakdownOpen && row.dailySheetId && <SheetCashBreakdown dailySheetId={row.dailySheetId} />}
    </Card>
  );
}
