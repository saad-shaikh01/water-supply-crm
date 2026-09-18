'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Ban, ExternalLink, Info, Lock, Scale } from 'lucide-react';
import { Skeleton, cn } from '@water-supply-crm/ui';
import type { CashLedgerHistoryResponse, CashLedgerRow } from '../api/van-cash-ledger.api';
import { manualCashInSourceLabel } from '../constants';
import { fmtDate, fmtDateTime, money, signedMoney } from '../format';
import { balanceText, balanceTone, entrySourceLabel, monthLabelOf, periodDisplayLabel } from './timeline-format';

type HistoryEntry = CashLedgerHistoryResponse['entry'];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-x-3 py-2 sm:grid-cols-[8rem_1fr]">
      <dt className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** Plain-words backdated / future line: "Belongs to 5 Jul · added 8 Jul, 6:10 pm (3 days later)". */
function lagSentence(row: CashLedgerRow): string | null {
  const lag = row.lagDays ?? 0;
  if (lag === 0 || !row.createdAt) return null;
  const when = lag > 0 ? `${plural(lag)} later` : `${plural(Math.abs(lag))} earlier`;
  return `Belongs to ${fmtDate(row.date)} · added ${fmtDateTime(row.createdAt)} (${when})`;
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading entry">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="grid grid-cols-[6.5rem_1fr] gap-x-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

interface EntryOverviewProps {
  row: CashLedgerRow | null;
  /** Header-only fallback (deep link to a row that isn't in a loaded page). */
  entry: HistoryEntry | undefined;
  entryLoading: boolean;
}

/** Overview tab: the entry's fields as a definition list, plus the handover / void / lock callouts. */
export function EntryOverview({ row, entry, entryLoading }: EntryOverviewProps) {
  if (!row) {
    if (entryLoading || !entry) return <OverviewSkeleton />;
    return (
      <div>
        <dl className="m-0 divide-y divide-border/40">
          <Field label="Type">{entrySourceLabel(entry.sourceType)}</Field>
          <Field label="Business date">{fmtDate(entry.date)}</Field>
          <Field label="Recorded">
            {fmtDateTime(entry.createdAt)}
            {entry.recordedByName ? ` by ${entry.recordedByName}` : ''}
          </Field>
          {entry.status && (
            <Field label="Status">{entry.status.charAt(0) + entry.status.slice(1).toLowerCase()}</Field>
          )}
        </dl>
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-border/40 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Open this entry from the list to act on it
        </p>
      </div>
    );
  }

  const isManualCashIn = row.type === 'OPENING_BALANCE';
  const isCashInLike = row.type === 'CASH_IN' || row.type === 'CASH_IN_CORRECTION';
  const isHandover = isCashInLike && row.expectedAmount != null;
  const lag = row.lagDays ?? 0;
  const lagText = lagSentence(row);
  const recordedBy = row.recordedByName ?? row.submittedByName ?? null;
  const sourceText = isManualCashIn ? manualCashInSourceLabel(row.source) : row.sourceBadge || null;
  const van = row.vanPlateNumber ?? (isManualCashIn ? 'Office-wide (no van)' : null);
  const variance = row.variance ?? 0;

  return (
    <div className="space-y-4">
      {row.isVoided && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3" role="note">
          <p className="flex items-center gap-2 text-xs font-bold text-destructive">
            <Ban className="h-3.5 w-3.5" aria-hidden />
            Voided
            {row.voidedByName ? ` by ${row.voidedByName}` : ''}
            {row.voidedAt ? ` · ${fmtDateTime(row.voidedAt)}` : ''}
          </p>
          {row.voidReason && (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-xs italic text-foreground/90">
              &ldquo;{row.voidReason}&rdquo;
            </p>
          )}
        </div>
      )}

      {row.periodClosed && (
        <p
          className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-500"
          role="note"
        >
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-bold">Closed period.</span> This entry belongs to{' '}
            {row.periodLabel ? periodDisplayLabel(row.periodLabel) : 'this period'}, a closed accounting period.
            Changes need an admin override{row.canOverride ? ' — you will be asked for a reason' : ''}.
          </span>
        </p>
      )}

      {row.editBlockedReason && (
        <p
          className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-500"
          role="note"
        >
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{row.editBlockedReason}</span>
        </p>
      )}

      <dl className="m-0 divide-y divide-border/40">
        <Field label="Business date">{fmtDate(row.date)}</Field>
        {row.relatesToDate && (
          <Field label="Belongs to">
            {fmtDate(row.relatesToDate)} · counted in {monthLabelOf(row.date)}
            <span className="mt-0.5 block text-xs text-muted-foreground">
              The original date is in a closed period, so this counts in the current one.
            </span>
          </Field>
        )}

        <Field label="Recorded">
          {row.createdAt ? (
            <>
              {fmtDateTime(row.createdAt)}
              {recordedBy ? ` by ${recordedBy}` : ''}
            </>
          ) : (
            (recordedBy ?? '—')
          )}
          {lagText && (
            <span className={cn('mt-0.5 block text-xs', lag >= 7 ? 'text-amber-500' : 'text-muted-foreground')}>
              {lagText}
            </span>
          )}
        </Field>

        {row.isEdited && (
          <Field label="Last edited">
            {row.lastEditedAt ? fmtDateTime(row.lastEditedAt) : 'Edited after it was recorded'}
          </Field>
        )}
        {isCashInLike && (
          <Field label="Status">{row.status === 'PENDING' ? 'Pending approval' : 'Approved'}</Field>
        )}
        {van && <Field label="Van">{van}</Field>}
        {row.employeeName && <Field label="Employee">{row.employeeName}</Field>}
        {sourceText && <Field label="Source">{sourceText}</Field>}
        {row.reference && (
          <Field label="Reference">
            <span className="font-mono">{row.reference}</span>
          </Field>
        )}
        {row.notes && (
          <Field label="Notes">
            <span className="whitespace-pre-wrap">{row.notes}</span>
          </Field>
        )}
        {row.hasAttachment !== undefined && <Field label="Attachment">{row.hasAttachment ? 'Yes' : 'No'}</Field>}
        {row.approvedByName && <Field label="Approved by">{row.approvedByName}</Field>}
        {row.dailySheetId && (
          <Field label="Sheet">
            <Link
              href={`/dashboard/daily-sheets/${row.dailySheetId}`}
              className="inline-flex min-h-11 items-center gap-1 text-primary hover:underline sm:min-h-0"
            >
              Open daily sheet <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
          </Field>
        )}
        <Field label="Balance after">
          <span className={cn('font-mono tabular-nums', balanceTone(row.runningBalance))}>
            {balanceText(row.runningBalance)}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">Whole ledger, not filtered</span>
        </Field>
      </dl>

      {isHandover && (
        <div className="rounded-2xl border border-border/50 bg-card/40 px-4 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            <Scale className="h-3.5 w-3.5" aria-hidden /> Sheet said vs approved
          </p>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Sheet said</dt>
            <dd className="m-0 text-right font-mono tabular-nums">{money(row.expectedAmount)}</dd>
            <dt className="text-muted-foreground">{row.status === 'PENDING' ? 'Submitted' : 'Approved'}</dt>
            <dd className="m-0 text-right font-mono font-bold tabular-nums">{money(row.amount)}</dd>
            <dt className="border-t border-border/40 pt-1 text-muted-foreground">Variance</dt>
            <dd className="m-0 border-t border-border/40 pt-1 text-right font-mono font-bold tabular-nums">
              {variance ? signedMoney(variance) : money(0)}
              <span className="sr-only">
                {variance < 0
                  ? ', approved less than the sheet'
                  : variance > 0
                    ? ', approved more than the sheet'
                    : ', no difference'}
              </span>
            </dd>
          </dl>
        </div>
      )}
    </div>
  );
}
