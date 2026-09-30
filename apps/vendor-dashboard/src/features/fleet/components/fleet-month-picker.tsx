'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Input } from '@water-supply-crm/ui';
import { currentMonth, shiftMonth } from '../lib/fleet-format';

interface FleetMonthPickerProps {
  month: string;
  onChange: (month: string) => void;
}

/** Prev / month input / next — never lets the picker move past the current month. */
export function FleetMonthPicker({ month, onChange }: FleetMonthPickerProps) {
  const now = currentMonth();
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Input
        type="month"
        value={month}
        max={now}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="h-10 w-40 rounded-xl"
      />
      <Button
        variant="outline"
        size="icon"
        className="h-10 w-10 rounded-xl"
        aria-label="Next month"
        disabled={month >= now}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      {month !== now && (
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => onChange(now)}>
          This month
        </Button>
      )}
    </div>
  );
}
