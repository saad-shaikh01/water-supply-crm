'use client';

import { Check, History } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { formatYmdShort } from '../../../lib/date-pkt';
import { money, signedMoney } from '../format';

/**
 * Shared, dependency-free helpers + the "As closed / Now" chip for the P4
 * accounting-period UI. Leaf module (imports nothing from the other period
 * components) so pill / panel / dialogs / banner can all use it without cycles.
 */

/** A cash balance with an explicit minus when negative (`money` alone is magnitude-only). */
export const balanceText = (n: number | null | undefined): string =>
  Number(n ?? 0) < 0 ? `− ${money(n)}` : money(n);

/** "2026-08" → "Aug 2026" (fallback when the periods list doesn't carry the label). */
export function periodLabelToDisplay(label: string | null | undefined): string {
  if (!label || !/^\d{4}-\d{2}$/.test(label)) return label ?? '';
  const [y, m] = label.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "2026-09-30" → "30 Sep 2026". */
export const ymdLong = (ymd: string): string => `${formatYmdShort(ymd)} ${ymd.slice(0, 4)}`;

/** Drift rounded to cents; anything below half a paisa counts as "unchanged". */
const normalizeDrift = (drift: number | null | undefined, closing: number, live: number): number => {
  const raw = drift ?? live - closing;
  return Math.abs(raw) < 0.005 ? 0 : raw;
};

const AMBER_CHIP = 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400';
const NEUTRAL_CHIP = 'border-border/60 bg-transparent text-muted-foreground';
const CHANGED_TITLE =
  'Entries were added or changed in this closed period after it was closed (admin overrides / late adjustments)';
const UNCHANGED_TITLE = 'Unchanged since the period was closed';

export interface PeriodDriftChipProps {
  closingBalance: number | null;
  liveClosingBalance: number;
  drift: number | null;
  className?: string;
}

/**
 * Closed-period drift: `As closed ₨ X ✓` when nothing moved since the close, else an amber
 * `As closed ₨ X · Now ₨ Y (± ₨ Δ)`. The delta carries an explicit "+" / "−" — never colour-only.
 * Renders nothing while the period is open (`closingBalance === null`).
 */
export function PeriodDriftChip({ closingBalance, liveClosingBalance, drift, className }: PeriodDriftChipProps) {
  if (closingBalance === null) return null;
  const d = normalizeDrift(drift, closingBalance, liveClosingBalance);

  if (d === 0) {
    return (
      <span
        title={UNCHANGED_TITLE}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-semibold leading-snug',
          NEUTRAL_CHIP,
          className,
        )}
      >
        <Check className="h-3 w-3 shrink-0" aria-hidden />
        <span>
          As closed <span className="font-mono tabular-nums">{balanceText(closingBalance)}</span>
          <span aria-hidden> ✓</span>
          <span className="sr-only">, unchanged since the period was closed</span>
        </span>
      </span>
    );
  }

  return (
    <span
      title={CHANGED_TITLE}
      className={cn(
        'inline-flex items-start gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-semibold leading-snug',
        AMBER_CHIP,
        className,
      )}
    >
      <History className="h-3 w-3 shrink-0 mt-0.5" aria-hidden />
      <span className="min-w-0">
        As closed <span className="font-mono tabular-nums">{balanceText(closingBalance)}</span>
        {' · '}Now <span className="font-mono tabular-nums">{balanceText(liveClosingBalance)}</span>
        {' '}(<span className="font-mono tabular-nums">{signedMoney(d)}</span>)
        <span className="sr-only">. Entries were changed after the period was closed.</span>
      </span>
    </span>
  );
}

/** Compact variant (tight spaces): just the signed change, or a tick when unchanged. */
export function PeriodDriftChipCompact({
  closingBalance,
  liveClosingBalance,
  drift,
  className,
}: PeriodDriftChipProps) {
  if (closingBalance === null) return null;
  const d = normalizeDrift(drift, closingBalance, liveClosingBalance);

  if (d === 0) {
    return (
      <span
        title={UNCHANGED_TITLE}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
          NEUTRAL_CHIP,
          className,
        )}
      >
        <Check className="h-3 w-3" aria-hidden />
        Unchanged
      </span>
    );
  }

  return (
    <span
      title={CHANGED_TITLE}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide',
        AMBER_CHIP,
        className,
      )}
    >
      <History className="h-3 w-3" aria-hidden />
      <span className="font-mono tabular-nums">{signedMoney(d)}</span>
      <span className="sr-only">since the period was closed</span>
    </span>
  );
}

/** Small amber dot for the header pill (paired with text in the pill's aria-label / title). */
export function PeriodDriftDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-background', className)}
    />
  );
}

/** True when a closed period's live figures differ from the closing snapshot. */
export const hasDrift = (p: { closingBalance: number | null; liveClosingBalance: number; drift: number | null }): boolean =>
  p.closingBalance !== null && normalizeDrift(p.drift, p.closingBalance, p.liveClosingBalance) !== 0;
