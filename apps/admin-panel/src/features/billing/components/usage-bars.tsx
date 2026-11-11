import type { Limits, Usage } from '../api/billing.api';
import { LIMIT_RESOURCES, exceedsLimits, limitText } from '../lib/billing';

/** Usage vs effective limits. Over-limit rows are flagged (never hidden). */
export function UsageBars({ usage, limits }: { usage: Usage; limits: Limits | null }) {
  const over = exceedsLimits(usage, limits);
  return (
    <div className="space-y-2" data-testid="usage-bars">
      {LIMIT_RESOURCES.map((r) => {
        const used = usage[r.key];
        const max = limits ? limits[r.limitKey] : null;
        const pct = max === null || max === 0 ? (used > 0 && max === 0 ? 100 : 0) : Math.min(100, Math.round((used / max) * 100));
        const isOver = max !== null && used > max;
        return (
          <div key={r.key} data-testid={`usage-${r.key}`} data-over={isOver}>
            <div className="flex justify-between text-xs">
              <span>{r.label}</span>
              <span className={isOver ? 'font-semibold text-destructive' : 'text-muted-foreground'}>
                {used} / {limitText(max)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={max ?? undefined} aria-label={`${r.label} usage`}>
              <div className={`h-full ${isOver ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      {over && (
        <p className="text-xs text-destructive" role="alert">
          Over the plan limits. Existing data is kept; creating more records is blocked.
        </p>
      )}
    </div>
  );
}
