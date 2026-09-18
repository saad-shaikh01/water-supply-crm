'use client';

import { useEffect, useState, type RefObject } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { useCashLedgerSummary } from '../hooks/use-van-cash-ledger';
import { money, signedMoney } from '../format';

interface CashLedgerMiniBarProps {
  /**
   * The element wrapping the summary hero. The bar appears only once this
   * element has scrolled completely out of view.
   */
  sentinelRef: RefObject<HTMLElement | null>;
  /** Opens the Pending Approvals panel (owned by the page). */
  onOpenPending: () => void;
}

/**
 * Compact fixed bar replacing the old bottom stats bar. Hidden while the
 * summary hero is on screen; once it scrolls away this keeps the one number
 * that matters (Expected closing) and the pending-approval count in reach.
 */
export function CashLedgerMiniBar({ sentinelRef, onOpenPending }: CashLedgerMiniBarProps) {
  const { data } = useCashLedgerSummary();
  // Start "visible" so the bar never flashes on first paint.
  const [heroVisible, setHeroVisible] = useState(true);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    // root: null clips through the dashboard's scrolling <main>, so this tracks in-container scroll too.
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setHeroVisible(last.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [sentinelRef]);

  if (heroVisible || !data) return null;

  const closing = data.statement.expectedClosing;
  const negative = closing < 0;
  const pending = (data.memo?.pendingHandovers?.count ?? 0) + (data.memo?.pendingRemittances?.count ?? 0);

  return (
    <div
      role="region"
      aria-label="Cash summary"
      className="fixed z-40 bottom-3 left-3 right-3 sm:left-auto sm:right-6 sm:bottom-6"
    >
      <div
        className={cn(
          'flex items-center gap-x-3 min-h-12 rounded-2xl border px-3 py-1.5 sm:px-4 sm:py-2 sm:w-max ml-auto',
          'bg-background/95 dark:bg-[#0a0a0f]/85 backdrop-blur-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.35)]',
          negative ? 'border-destructive/40' : 'border-border',
        )}
      >
        <div className="min-w-0 flex-1 sm:flex-none flex flex-wrap items-baseline gap-x-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Expected closing
          </span>
          <span
            className={cn(
              'font-mono font-black tabular-nums text-sm sm:text-base',
              negative ? 'text-destructive' : 'text-foreground',
            )}
          >
            {negative ? '−' : ''}{money(closing)}
          </span>
          {negative && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-destructive">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Negative
            </span>
          )}
        </div>

        <span className="hidden sm:inline text-xs font-medium text-muted-foreground whitespace-nowrap">
          Net{' '}
          <span className="font-mono font-bold tabular-nums text-foreground">{signedMoney(data.statement.net)}</span>
        </span>

        {pending > 0 && (
          <button
            type="button"
            onClick={onOpenPending}
            aria-label={`${pending} pending ${pending === 1 ? 'approval' : 'approvals'} — review`}
            className="shrink-0 inline-flex items-center gap-1.5 h-11 sm:h-8 rounded-full px-3 text-[11px] font-bold whitespace-nowrap bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors"
          >
            <AlertCircle className="h-3.5 w-3.5" aria-hidden />
            {pending} pending
          </button>
        )}
      </div>
    </div>
  );
}
