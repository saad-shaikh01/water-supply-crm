'use client';

import { useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { useViewedPeriod } from './cash-ledger-period-pill';
import { ReopenPeriodDialog } from './reopen-period-dialog';
import { PeriodDriftChip } from './period-drift-chip';

/**
 * Calm notice shown when the ledger's date range lies inside ONE closed accounting period.
 * Renders nothing for an open period, a multi-month range, or while periods are unavailable.
 */
export function CashLedgerPeriodBanner() {
  const { viewed, data } = useViewedPeriod();
  const [reopenOpen, setReopenOpen] = useState(false);

  if (!data || !viewed || viewed.status !== 'CLOSED') return null;

  const canReopen = data.permissions.canClose && viewed.canReopen;

  return (
    <>
      <div
        role="status"
        className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 rounded-2xl border border-border/60 bg-muted/30 px-3 py-2.5 sm:px-4"
      >
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs sm:text-sm font-semibold break-words">
              You&apos;re viewing <span className="font-black">{viewed.displayLabel}</span> — a closed period. Changes
              need an admin override with a reason.
            </p>
            <PeriodDriftChip
              closingBalance={viewed.closingBalance}
              liveClosingBalance={viewed.liveClosingBalance}
              drift={viewed.drift}
            />
          </div>
        </div>
        {canReopen && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReopenOpen(true)}
            className="h-11 sm:h-8 rounded-full px-4 text-xs font-bold gap-1.5 w-full sm:w-auto shrink-0"
          >
            <Unlock className="h-3.5 w-3.5" aria-hidden />
            Reopen
          </Button>
        )}
      </div>

      <ReopenPeriodDialog label={viewed.label} open={reopenOpen} onOpenChange={setReopenOpen} />
    </>
  );
}
