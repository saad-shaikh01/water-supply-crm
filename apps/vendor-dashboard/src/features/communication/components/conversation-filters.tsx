'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@water-supply-crm/ui';
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
}

/**
 * Inbox filter bar. Search/Van/Driver/Date reuse the existing self-contained
 * shared filter widgets (own nuqs state + debounce). Status and "Waiting on"
 * (Phase 5 — derived from lastMessageSenderRole server-side, never stored)
 * are both plain read filters — no resolve/reopen controls live here
 * (those are on conversation-header.tsx).
 */
export function ConversationFilters({
  status,
  onStatusChange,
  waitingOn,
  onWaitingOnChange,
  isDriver,
  onBeforeChange,
}: ConversationFiltersProps) {
  return (
    <div className="flex flex-col gap-2.5 p-3 border-b border-border/40">
      <SearchInput placeholder="Search customer name or code…" onBeforeChange={onBeforeChange} />

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="w-[140px] h-9 rounded-xl bg-background/50 border-border/50 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-border/50 shadow-2xl">
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="rounded-lg text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={waitingOn} onValueChange={onWaitingOnChange}>
          <SelectTrigger className="w-[170px] h-9 rounded-xl bg-background/50 border-border/50 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-border/50 shadow-2xl">
            {WAITING_ON_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="rounded-lg text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!isDriver && <VanFilter onBeforeChange={onBeforeChange} />}
        {!isDriver && <DriverFilter onBeforeChange={onBeforeChange} />}
        <DateRangePicker className="w-auto" />
      </div>
    </div>
  );
}
