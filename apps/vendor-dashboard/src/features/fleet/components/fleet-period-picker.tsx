'use client';

import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@water-supply-crm/ui';
import { currentMonth, monthToRange, shiftMonth, toISODate } from '../lib/fleet-format';

export type PeriodPreset = 'this-month' | 'last-month' | 'last-3' | 'this-year' | 'all' | 'custom';

export interface FleetPeriod {
  preset: PeriodPreset;
  dateFrom?: string;
  dateTo?: string;
}

/** Resolves a preset to concrete inclusive calendar days (undefined = unbounded). */
export function periodFromPreset(preset: Exclude<PeriodPreset, 'custom'>): FleetPeriod {
  const now = currentMonth();
  switch (preset) {
    case 'this-month':
      return { preset, ...monthToRange(now) };
    case 'last-month':
      return { preset, ...monthToRange(shiftMonth(now, -1)) };
    case 'last-3':
      return { preset, dateFrom: monthToRange(shiftMonth(now, -2)).dateFrom, dateTo: toISODate(new Date()) };
    case 'this-year':
      return { preset, dateFrom: `${new Date().getFullYear()}-01-01`, dateTo: toISODate(new Date()) };
    default:
      return { preset: 'all' };
  }
}

const LABELS: Record<PeriodPreset, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-3': 'Last 3 months',
  'this-year': 'This year',
  all: 'All time',
  custom: 'Custom range',
};

interface FleetPeriodPickerProps {
  value: FleetPeriod;
  onChange: (period: FleetPeriod) => void;
}

/** Period selector for the vehicle detail page — every tab reads the same range. */
export function FleetPeriodPicker({ value, onChange }: FleetPeriodPickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value.preset}
        onValueChange={(v) => {
          const preset = v as PeriodPreset;
          onChange(preset === 'custom' ? { preset, dateFrom: value.dateFrom, dateTo: value.dateTo } : periodFromPreset(preset));
        }}
      >
        <SelectTrigger className="h-10 w-44 rounded-xl">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-xl">
          {(Object.keys(LABELS) as PeriodPreset[]).map((p) => (
            <SelectItem key={p} value={p}>{LABELS[p]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.preset === 'custom' && (
        <>
          <Input
            type="date"
            value={value.dateFrom ?? ''}
            max={value.dateTo || undefined}
            onChange={(e) => onChange({ ...value, dateFrom: e.target.value || undefined })}
            className="h-10 w-40 rounded-xl"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={value.dateTo ?? ''}
            min={value.dateFrom || undefined}
            onChange={(e) => onChange({ ...value, dateTo: e.target.value || undefined })}
            className="h-10 w-40 rounded-xl"
          />
        </>
      )}
    </div>
  );
}
