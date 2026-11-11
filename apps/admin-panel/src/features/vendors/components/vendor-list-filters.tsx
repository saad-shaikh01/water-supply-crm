'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@water-supply-crm/ui';
import { Search } from 'lucide-react';
import type { VendorStatusFilter } from '../types';

interface Props {
  search: string;
  status: VendorStatusFilter;
  onSearch: (v: string) => void;
  onStatus: (v: VendorStatusFilter) => void;
}

const OPTIONS: { value: VendorStatusFilter; label: string }[] = [
  { value: 'all', label: 'All vendors' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'live', label: 'Live' },
  { value: 'not_live', label: 'Not live' },
];

export const SEARCH_DEBOUNCE_MS = 300;

/** Search (debounced 300 ms) + status filter. Both live in the URL through the parent hook. */
export function VendorListFilters({ search, status, onSearch, onStatus }: Props) {
  const [text, setText] = useState(search);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;
  const lastSent = useRef(search);

  // URL -> input (back/forward, "clear filters")
  useEffect(() => {
    if (search !== lastSent.current) {
      lastSent.current = search;
      setText(search);
    }
  }, [search]);

  // input -> URL, debounced
  useEffect(() => {
    if (text === lastSent.current) return;
    const t = setTimeout(() => {
      lastSent.current = text;
      onSearchRef.current(text);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          aria-label="Search vendors"
          placeholder="Search name, slug or admin email"
          className="pl-9"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <select
        aria-label="Filter by status"
        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        value={status}
        onChange={(e) => onStatus(e.target.value as VendorStatusFilter)}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
