'use client';

import { useQueryState, parseAsString } from 'nuqs';
import { cn } from '@water-supply-crm/ui';

const PRESETS = [
  { label: 'Today', getValue: () => { const d = today(); return { from: d, to: d }; } },
  { label: 'This Week', getValue: () => { const d = new Date(); const mon = new Date(d); mon.setDate(d.getDate() - d.getDay() + 1); return { from: fmt(mon), to: today() }; } },
  { label: 'This Month', getValue: () => { const d = new Date(); return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, to: today() }; } },
  { label: 'Last Month', getValue: () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); const end = new Date(d.getFullYear(), d.getMonth() + 1, 0); return { from: fmt(d), to: fmt(end) }; } },
  { label: 'Last 3 Months', getValue: () => { const d = new Date(); d.setMonth(d.getMonth() - 3); return { from: fmt(d), to: today() }; } },
  { label: 'This Year', getValue: () => ({ from: `${new Date().getFullYear()}-01-01`, to: today() }) },
];

function today() { return fmt(new Date()); }
function fmt(d: Date) { return d.toISOString().slice(0, 10); }

export interface DateRange {
  from: string;
  to: string;
}

interface DateRangePickerProps {
  className?: string;
}

export function DateRangePicker({ className }: DateRangePickerProps) {
  const [from, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [to, setTo] = useQueryState('to', parseAsString.withDefault(''));

  const activePreset = PRESETS.find((p) => {
    const v = p.getValue();
    return v.from === from && v.to === to;
  });

  const applyPreset = async (preset: typeof PRESETS[number]) => {
    const v = preset.getValue();
    await setFrom(v.from);
    await setTo(v.to);
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {PRESETS.map((preset) => (
        <button
          key={preset.label}
          onClick={() => applyPreset(preset)}
          className={cn(
            'px-3 py-1.5 text-xs font-semibold rounded-full border transition-all duration-200',
            activePreset?.label === preset.label
              ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/25'
              : 'bg-card/40 text-muted-foreground border-border/50 hover:border-primary/50 hover:text-foreground'
          )}
        >
          {preset.label}
        </button>
      ))}
      <div className="flex items-center gap-1 ml-1">
        <span className="text-xs text-muted-foreground font-medium">From</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value || null)}
          className="text-xs px-2 py-1.5 rounded-lg border border-border/50 bg-card/40 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <span className="text-xs text-muted-foreground font-medium">To</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value || null)}
          className="text-xs px-2 py-1.5 rounded-lg border border-border/50 bg-card/40 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        {(from || to) && (
          <button
            onClick={async () => { await setFrom(null); await setTo(null); }}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors ml-1"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
