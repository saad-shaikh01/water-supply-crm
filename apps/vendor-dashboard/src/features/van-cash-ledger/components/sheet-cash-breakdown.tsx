'use client';

import { Skeleton, Button, cn } from '@water-supply-crm/ui';
import { useSheetCashBreakdown } from '../hooks/use-van-cash-ledger';
import { money, moneyOrDash, signedMoney } from '../format';

/** Cash-out figure as a negative magnitude; zero renders as an em dash. */
const neg = (n: number) => (n ? signedMoney(-Math.abs(n)) : '—');

function Line({
  label, value, strong, muted, tone,
}: { label: string; value: string; strong?: boolean; muted?: boolean; tone?: string }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3',
        strong && 'border-t border-border/40 pt-1.5 mt-1.5 font-bold',
        muted && 'text-muted-foreground',
      )}
    >
      <span className="text-xs min-w-0">{label}</span>
      <span className={cn('font-mono text-xs tabular-nums shrink-0', strong && 'font-black', tone)}>{value}</span>
    </div>
  );
}

/**
 * Sheet Cash Breakdown — how a driver's sheet cash was derived:
 * Collected − Expenses paid from cash − Crew Cash = Net cash from sheet.
 * Loaded lazily (mounted only when expanded); display only.
 */
export function SheetCashBreakdown({ dailySheetId }: { dailySheetId: string }) {
  const { data, isLoading, isError, refetch, isFetching } = useSheetCashBreakdown(dailySheetId, true);

  const approvedLabel = data && data.variance !== 0
    ? `Approved as (${[
        signedMoney(data.variance),
        data.adjustmentReason ? `“${data.adjustmentReason}”` : null,
        data.approvedByName ? `by ${data.approvedByName}` : null,
      ].filter(Boolean).join(' · ')})`
    : '';

  return (
    <div
      className="mx-3 mb-3 rounded-xl border border-border/40 bg-muted/20 p-3"
      role="group"
      aria-label="Sheet cash breakdown"
    >
      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : isError || !data ? (
        <div className="flex items-center justify-between gap-3" role="alert">
          <span className="text-xs text-muted-foreground">Couldn&apos;t load the cash breakdown.</span>
          <Button variant="outline" size="sm" className="h-9" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      ) : (
        <div className="space-y-0.5 max-w-md">
          <Line label="Collected" value={money(data.collected)} />
          <Line label="− Expenses paid from cash" value={neg(data.expenses)} tone="text-destructive" />
          <Line label="− Crew Cash" value={neg(data.crewCash)} tone="text-pink-500" />
          <Line label="= Net cash from sheet" value={moneyOrDash(data.netFromSheet)} strong />
          {data.other !== 0 && <Line label="± Other / corrections" value={signedMoney(data.other)} muted />}
          {data.variance !== 0 && <Line label={approvedLabel} value={money(data.approved)} strong />}
          <p className="text-[10px] text-muted-foreground pt-2">
            Display only — crew cash on sheets is already inside Sheet Cash In.
          </p>
        </div>
      )}
    </div>
  );
}
