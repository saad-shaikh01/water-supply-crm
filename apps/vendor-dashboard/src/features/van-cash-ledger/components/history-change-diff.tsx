'use client';

import { ArrowRight } from 'lucide-react';
import { Badge, cn } from '@water-supply-crm/ui';
import type { CashLedgerHistoryChange } from '../api/van-cash-ledger.api';
import { fmtDate, money } from '../format';

type ChangeValue = CashLedgerHistoryChange['before'];

const isEmpty = (v: ChangeValue): boolean => v === null || v === undefined || v === '';

/** `YYYY-MM-DD` / ISO → `8 Jul 2026`; anything unparseable is shown as-is rather than "Invalid Date". */
function formatDateValue(v: string | number | boolean): string {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : fmtDate(d.toISOString());
}

/** Human form of a status token: `PENDING` -> `Pending`, `IN_PROGRESS` -> `In progress`. */
const statusText = (v: string | number | boolean): string => {
  const s = String(v).replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** One before / after value, formatted by the change's `kind`. `null` is always an em dash. */
function ChangeValueView({ value, kind, struck }: { value: ChangeValue; kind: CashLedgerHistoryChange['kind']; struck: boolean }) {
  if (isEmpty(value)) return <span className="text-muted-foreground">—</span>;
  const v = value as string | number | boolean;

  switch (kind) {
    case 'money':
      return <span className="font-mono tabular-nums">{money(Number(v))}</span>;
    case 'date':
      return <span>{formatDateValue(v)}</span>;
    case 'boolean':
      return <span>{v === true || v === 'true' ? 'Yes' : 'No'}</span>;
    case 'status':
      return (
        <Badge
          variant="outline"
          className={cn(
            'px-1.5 py-0 text-[10px] font-semibold normal-case tracking-normal',
            struck && 'line-through',
          )}
        >
          {statusText(v)}
        </Badge>
      );
    default:
      return <span className="whitespace-pre-wrap break-words">{String(v)}</span>;
  }
}

/**
 * The before → after list of one history event. The old value is struck through
 * and muted, the new value emphasised; "was" / "now" are announced to screen
 * readers so the change never depends on the strike-through alone.
 */
export function HistoryChangeDiff({ changes }: { changes: CashLedgerHistoryChange[] }) {
  if (changes.length === 0) return null;

  return (
    <ul className="mt-2 space-y-1.5 rounded-xl border border-border/40 bg-muted/20 px-3 py-2">
      {changes.map((change, i) => {
        const hadBefore = !isEmpty(change.before);
        return (
          <li key={`${change.field}:${i}`} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <span className="text-[11px] font-semibold text-muted-foreground sm:w-24 sm:shrink-0">{change.label}</span>
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
              <span className={cn('min-w-0', hadBefore && 'text-muted-foreground line-through decoration-muted-foreground/60')}>
                <span className="sr-only">was </span>
                <ChangeValueView value={change.before} kind={change.kind} struck={hadBefore} />
              </span>
              <ArrowRight className="h-3 w-3 shrink-0 self-center text-muted-foreground" aria-hidden />
              <span className="min-w-0 font-semibold text-foreground">
                <span className="sr-only">now </span>
                <ChangeValueView value={change.after} kind={change.kind} struck={false} />
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
