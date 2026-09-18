'use client';

import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { CalendarRange, X, ChevronDown } from 'lucide-react';
import { Button, Input, Label } from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import {
  formatYmdShort,
  rangeLast3Months,
  rangeLastMonth,
  rangeThisMonth,
  rangeThisWeek,
  rangeThisYear,
  rangeToday,
  rangeYesterday,
  type YmdRange,
} from '../../lib/date-pkt';

interface DatePreset {
  label: string;
  getValue: () => YmdRange;
}

/**
 * Every preset the picker knows, in display order. All ranges are Asia/Karachi
 * calendar dates (see `lib/date-pkt.ts`) — "Today" is never a UTC day.
 * The `presets` prop selects/reorders a subset by label.
 */
const ALL_PRESETS: DatePreset[] = [
  { label: 'Today', getValue: () => rangeToday() },
  { label: 'Yesterday', getValue: () => rangeYesterday() },
  { label: 'This Week', getValue: () => rangeThisWeek() },
  { label: 'This Month', getValue: () => rangeThisMonth() },
  { label: 'Last Month', getValue: () => rangeLastMonth() },
  { label: 'Last 3 Months', getValue: () => rangeLast3Months() },
  { label: 'This Year', getValue: () => rangeThisYear() },
];

export const DATE_RANGE_PRESET_LABELS = ALL_PRESETS.map((p) => p.label);

interface DateRangePickerProps {
  className?: string;
  /** Preset labels to offer, in order. Defaults to every preset. Unknown labels are ignored. */
  presets?: string[];
  /**
   * Preset that applies while the URL has no `from`/`to`. The trigger shows it
   * as the active selection (no "All Dates", no clear-X) and Clear returns to it.
   * The caller's data hooks must resolve the same range for an empty URL.
   */
  defaultPreset?: string;
  /** Called after any range change (preset, custom input, clear) — e.g. to reset pagination. */
  onChange?: () => void;
}

export function DateRangePicker({ className, presets, defaultPreset, onChange }: DateRangePickerProps) {
  const [from, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [to, setTo] = useQueryState('to', parseAsString.withDefault(''));
  const [open, setOpen] = useState(false);

  const visiblePresets: DatePreset[] = presets
    ? presets
        .map((label) => ALL_PRESETS.find((p) => p.label === label))
        .filter((p): p is DatePreset => !!p)
    : ALL_PRESETS;

  const defaultRange = defaultPreset
    ? ALL_PRESETS.find((p) => p.label === defaultPreset)?.getValue() ?? null
    : null;

  const hasUrlRange = !!from || !!to;
  // With a default preset and an empty URL, that preset's range IS the effective range.
  const usingDefault = !hasUrlRange && !!defaultRange;
  const effectiveFrom = usingDefault ? defaultRange.from : from;
  const effectiveTo = usingDefault ? defaultRange.to : to;
  const hasRange = !!effectiveFrom || !!effectiveTo;

  const activePreset = visiblePresets.find((p) => {
    const v = p.getValue();
    return v.from === effectiveFrom && v.to === effectiveTo;
  });
  const isCustom = hasRange && !activePreset;
  // At the default (implicitly, or explicitly typed into the URL) there is nothing to clear.
  const atDefault = !!defaultRange && (!hasUrlRange || activePreset?.label === defaultPreset);
  const showClear = hasUrlRange && !atDefault;

  const triggerLabel = activePreset?.label
    ?? (hasRange
      ? `Custom · ${effectiveFrom ? formatYmdShort(effectiveFrom) : '…'}  →  ${effectiveTo ? formatYmdShort(effectiveTo) : '…'}`
      : 'All Dates');

  const reset = () => {
    void setFrom(null);
    void setTo(null);
    onChange?.();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    reset();
  };

  const handlePreset = (preset: DatePreset) => {
    const v = preset.getValue();
    void setFrom(v.from);
    void setTo(v.to);
    onChange?.();
    setOpen(false);
  };

  // Editing one custom input while the default range is implied pins the other
  // side to the default's value, so the URL always carries an explicit range.
  const handleFromInput = (value: string) => {
    void setFrom(value || null);
    if (usingDefault) void setTo(defaultRange.to);
    onChange?.();
  };

  const handleToInput = (value: string) => {
    void setTo(value || null);
    if (usingDefault) void setFrom(defaultRange.from);
    onChange?.();
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
          {showClear ? (
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
              {visiblePresets.map((preset) => (
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
              {isCustom && (
                <span
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-full border bg-primary text-primary-foreground border-primary shadow-sm"
                  aria-current="true"
                >
                  Custom
                </span>
              )}
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
                  value={effectiveFrom}
                  max={effectiveTo || undefined}
                  onChange={(e) => handleFromInput(e.target.value)}
                  className="h-9 rounded-xl bg-background/50 border-border/50 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">To</Label>
                <Input
                  type="date"
                  value={effectiveTo}
                  min={effectiveFrom || undefined}
                  onChange={(e) => handleToInput(e.target.value)}
                  className="h-9 rounded-xl bg-background/50 border-border/50 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-2">
            {showClear && (
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 rounded-xl text-xs font-bold"
                onClick={() => { reset(); setOpen(false); }}
              >
                {defaultPreset ? `Reset to ${defaultPreset}` : 'Clear'}
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
