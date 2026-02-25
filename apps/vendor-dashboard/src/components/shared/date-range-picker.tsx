'use client';

import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { CalendarRange, X, ChevronDown } from 'lucide-react';
import { Button, Input, Label } from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';

const PRESETS = [
  { label: 'Today', getValue: () => { const d = toIso(new Date()); return { from: d, to: d }; } },
  {
    label: 'This Week', getValue: () => {
      const d = new Date(); const mon = new Date(d);
      mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return { from: toIso(mon), to: toIso(new Date()) };
    }
  },
  {
    label: 'This Month', getValue: () => {
      const d = new Date();
      return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, to: toIso(d) };
    }
  },
  {
    label: 'Last Month', getValue: () => {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { from: toIso(d), to: toIso(end) };
    }
  },
  {
    label: 'Last 3 Months', getValue: () => {
      const d = new Date(); d.setMonth(d.getMonth() - 3);
      return { from: toIso(d), to: toIso(new Date()) };
    }
  },
  { label: 'This Year', getValue: () => ({ from: `${new Date().getFullYear()}-01-01`, to: toIso(new Date()) }) },
];

function toIso(d: Date) { return d.toISOString().slice(0, 10); }

function fmtDisplay(dateStr: string) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

interface DateRangePickerProps {
  className?: string;
}

export function DateRangePicker({ className }: DateRangePickerProps) {
  const [from, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [to, setTo] = useQueryState('to', parseAsString.withDefault(''));
  const [open, setOpen] = useState(false);

  const hasRange = !!from || !!to;

  const activePreset = PRESETS.find((p) => {
    const v = p.getValue();
    return v.from === from && v.to === to;
  });

  const triggerLabel = activePreset?.label
    ?? (hasRange ? `${from ? fmtDisplay(from) : '…'}  →  ${to ? fmtDisplay(to) : '…'}` : 'All Dates');

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFrom(null);
    setTo(null);
  };

  const handlePreset = async (preset: typeof PRESETS[number]) => {
    const v = preset.getValue();
    await setFrom(v.from);
    await setTo(v.to);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 h-10 px-3 rounded-xl border text-sm font-medium transition-colors w-full',
            'bg-background/50 border-border/50 hover:border-primary/40 hover:bg-accent/50',
            hasRange && 'border-primary/40 text-primary',
            className,
          )}
        >
          <CalendarRange className={cn('h-4 w-4 shrink-0', hasRange ? 'text-primary' : 'text-muted-foreground')} />
          <span className={cn('flex-1 text-left truncate text-sm', !hasRange && 'text-muted-foreground')}>
            {triggerLabel}
          </span>
          {hasRange ? (
            <X
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={handleClear}
            />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="start"
          className={cn(
            'z-50 w-80 rounded-2xl border border-border/60 bg-popover text-popover-foreground shadow-2xl p-4 space-y-4 outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          {/* Presets */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Quick Select</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handlePreset(preset)}
                  className={cn(
                    'px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-all',
                    activePreset?.label === preset.label
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-card/40 text-muted-foreground border-border/50 hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom range inputs */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Custom Range</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">From</Label>
                <Input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value || null)}
                  className="h-9 rounded-xl bg-background/50 border-border/50 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">To</Label>
                <Input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value || null)}
                  className="h-9 rounded-xl bg-background/50 border-border/50 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-2">
            {hasRange && (
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 rounded-xl text-xs font-bold"
                onClick={() => { setFrom(null); setTo(null); setOpen(false); }}
              >
                Clear
              </Button>
            )}
            <Button
              size="sm"
              className="flex-1 rounded-xl text-xs font-bold"
              onClick={() => setOpen(false)}
            >
              Apply
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
