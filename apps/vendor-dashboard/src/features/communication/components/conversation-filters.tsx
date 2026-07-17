'use client';

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  Badge,
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  cn,
} from '@water-supply-crm/ui';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { VanFilter } from '../../../components/shared/filters/van-filter';
import { DriverFilter } from '../../../components/shared/filters/driver-filter';
import { DateRangePicker } from '../../../components/shared/date-range-picker';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'OPEN', label: 'Open' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

const WAITING_ON_OPTIONS = [
  { value: 'all', label: 'Waiting: Anyone' },
  { value: 'DRIVER', label: 'Waiting on Driver' },
  { value: 'OFFICE', label: 'Waiting on Office' },
];

interface ConversationFiltersProps {
  status: string;
  onStatusChange: (value: string) => void;
  waitingOn: string;
  onWaitingOnChange: (value: string) => void;
  isDriver: boolean;
  onBeforeChange: () => void;
  /** Count of active filters (status/waitingOn/van/driver/date) — drives the badge on the Filters button. */
  activeFilterCount: number;
}

/**
 * Inbox filter bar. Search stays inline; every other filter (Status, Waiting
 * on, Van, Driver, Date) is grouped behind a single "Filters" button that
 * opens a Sheet — same pattern as /dashboard/orders and /dashboard/tickets'
 * "More Filters" drawer, instead of a row of separate dropdowns. Van/Driver/
 * Date reuse the existing self-contained shared filter widgets (own nuqs
 * state + debounce).
 */
export function ConversationFilters({
  status,
  onStatusChange,
  waitingOn,
  onWaitingOnChange,
  isDriver,
  onBeforeChange,
  activeFilterCount,
}: ConversationFiltersProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2.5 p-3 border-b border-border/40">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <SearchInput placeholder="Search customer name or code…" onBeforeChange={onBeforeChange} />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className={cn(
            'rounded-xl h-9 px-3 gap-1.5 font-semibold shrink-0',
            activeFilterCount > 0 && 'border-primary text-primary',
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge className="h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px] font-black">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm bg-background/95 backdrop-blur-xl border-l border-border/50">
          <SheetHeader className="pb-6 border-b">
            <SheetTitle className="flex items-center gap-2 text-lg font-bold">
              <SlidersHorizontal className="h-5 w-5 text-primary" /> Filters
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-6 py-6">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</Label>
              <Select value={status} onValueChange={onStatusChange}>
                <SelectTrigger className="rounded-xl bg-background/50 border-border/50 h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/50 shadow-2xl">
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="rounded-lg">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Waiting On</Label>
              <Select value={waitingOn} onValueChange={onWaitingOnChange}>
                <SelectTrigger className="rounded-xl bg-background/50 border-border/50 h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/50 shadow-2xl">
                  {WAITING_ON_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="rounded-lg">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!isDriver && (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Van</Label>
                <VanFilter onBeforeChange={onBeforeChange} />
              </div>
            )}

            {!isDriver && (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Driver</Label>
                <DriverFilter onBeforeChange={onBeforeChange} />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Delivery Date</Label>
              <DateRangePicker className="w-full" />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
