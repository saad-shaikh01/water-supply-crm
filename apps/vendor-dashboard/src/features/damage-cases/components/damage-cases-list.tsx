'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Eye, X, SlidersHorizontal } from 'lucide-react';
import { Badge, Button, Input, Label } from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { DataTable } from '../../../components/shared/data-table';
import { CustomerLink } from '../../../components/shared/customer-link';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useDamageCases } from '../hooks/use-damage-cases';
import type { DamageCaseStatus, DamageSeverity } from '../api/damage-cases.api';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'REPORTED', label: 'Reported' },
  { value: 'UNDER_REVIEW', label: 'Under Review' },
  { value: 'CHARGED', label: 'Charged' },
  { value: 'WAIVED', label: 'Waived' },
  { value: 'REVERSED', label: 'Reversed' },
];

const SEVERITY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Severities' },
  { value: 'MINOR', label: 'Minor' },
  { value: 'MODERATE', label: 'Moderate' },
  { value: 'SEVERE', label: 'Severe' },
];

const SEVERITY_COLORS: Record<string, string> = {
  MINOR: 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20',
  MODERATE: 'bg-orange-500/10 text-orange-500 border border-orange-500/20',
  SEVERE: 'bg-red-500/10 text-red-500 border border-red-500/20',
};

export function DamageCasesList() {
  const router = useRouter();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [severity, setSeverity] = useQueryState('severity', parseAsString.withDefault(''));
  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));
  // Empty default so "Clear" can actually remove the date filter (a non-empty
  // default would revert to the last-30-days range when cleared).
  const [dateFrom, setDateFrom] = useQueryState('dateFrom', parseAsString.withDefault(''));
  const [dateTo, setDateTo] = useQueryState('dateTo', parseAsString.withDefault(''));

  const query = {
    page,
    limit,
    status: status ? (status as DamageCaseStatus) : undefined,
    severity: severity ? (severity as DamageSeverity) : undefined,
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const { data, isLoading } = useDamageCases(query);

  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  const resetPage = () => setPage(1);

  const activeChips = [
    status ? { label: `Status: ${STATUS_OPTIONS.find((o) => o.value === status)?.label}`, clear: () => { setStatus(null); resetPage(); } } : null,
    severity ? { label: `Severity: ${severity}`, clear: () => { setSeverity(null); resetPage(); } } : null,
    search ? { label: `Search: ${search}`, clear: () => { setSearch(null); resetPage(); } } : null,
    (dateFrom || dateTo) ? { label: `Date: ${dateFrom || '...'} to ${dateTo || '...'}`, clear: () => { setDateFrom(null); setDateTo(null); resetPage(); } } : null,
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  const activeFilterCount = [status, severity, dateFrom || dateTo].filter(Boolean).length;

  const clearAll = () => {
    setStatus(null);
    setSeverity(null);
    setSearch(null);
    setDateFrom(null);
    setDateTo(null);
    resetPage();
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 bg-card/30 p-3 sm:p-4 rounded-2xl border border-border">
        <div className="flex items-center gap-2 flex-wrap flex-1">
          {/* Status select */}
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value || null); resetPage(); }}
            className="h-9 sm:h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 pr-8 outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer min-w-[140px]"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-background text-foreground dark:text-white">
                {opt.label}
              </option>
            ))}
          </select>

          {/* Severity select */}
          <select
            value={severity}
            onChange={(e) => { setSeverity(e.target.value || null); resetPage(); }}
            className="h-9 sm:h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 pr-8 outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer min-w-[140px]"
          >
            {SEVERITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-background text-foreground dark:text-white">
                {opt.label}
              </option>
            ))}
          </select>

          {/* Search */}
          <input
            type="text"
            placeholder="Search customer or driver..."
            value={search}
            onChange={(e) => { setSearch(e.target.value || null); resetPage(); }}
            className="h-9 sm:h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white placeholder:text-muted-foreground px-3 outline-none focus:ring-2 focus:ring-primary/30 min-w-[200px] flex-1"
          />
        </div>

        {/* More filters (date range) */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiltersOpen((v) => !v)}
          className={cn(
            'rounded-xl h-9 sm:h-10 px-3 sm:px-4 gap-2 font-semibold shrink-0',
            activeFilterCount > 0 && 'border-primary text-primary',
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <Badge className="h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px] font-black">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Date range inline (shown when filters open) */}
      {filtersOpen && (
        <div className="flex flex-wrap items-end gap-4 p-4 rounded-2xl border border-border bg-card/20">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              From Date
            </Label>
            <Input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => { setDateFrom(e.target.value || null); resetPage(); }}
              className="h-10 rounded-xl bg-background/50 border-border text-sm w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              To Date
            </Label>
            <Input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => { setDateTo(e.target.value || null); resetPage(); }}
              className="h-10 rounded-xl bg-background/50 border-border text-sm w-40"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setDateFrom(null); setDateTo(null); resetPage(); }}
            className="h-10 rounded-xl text-muted-foreground"
          >
            Clear Dates
          </Button>
        </div>
      )}

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {activeChips.map((chip) => (
            <button
              key={chip.label}
              onClick={chip.clear}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
            >
              {chip.label}
              <X className="h-3 w-3" />
            </button>
          ))}
          <button
            onClick={clearAll}
            className="text-xs text-muted-foreground hover:text-foreground font-semibold underline-offset-2 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Table */}
      {!isLoading && rows.length === 0 && (
        <div className="py-12 text-center text-muted-foreground space-y-2">
          {(status || severity || search || dateFrom || dateTo) ? (
            <>
              <p className="font-semibold">No results match your filters.</p>
              <button onClick={clearAll} className="text-xs text-primary underline hover:no-underline font-bold">Clear filters</button>
            </>
          ) : (
            <p className="font-semibold">No damage cases have been recorded yet.</p>
          )}
        </div>
      )}
      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No damage cases found."
        columns={[
          {
            key: 'date',
            header: 'Date',
            cell: (r) => (
              <div className="flex items-center gap-2 text-muted-foreground/80 whitespace-nowrap">
                <Calendar className="h-3 w-3 shrink-0" />
                <span className="text-xs font-medium tabular-nums">
                  {new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            ),
          },
          {
            key: 'driver',
            header: 'Driver',
            cell: (r) => (
              <span className="text-sm font-medium">{r.driver?.name ?? '—'}</span>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            cell: (r) => (
              <div className="flex flex-col min-w-0 max-w-[180px]">
                <CustomerLink id={r.customer?.id} name={r.customer?.name} className="font-bold text-sm text-foreground dark:text-white truncate" />
                {r.customer?.customerCode && (
                  <span className="text-[10px] text-muted-foreground/60 font-mono">{r.customer.customerCode}</span>
                )}
              </div>
            ),
          },
          {
            key: 'severity',
            header: 'Severity',
            cell: (r) => (
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold ${(r.severity && SEVERITY_COLORS[r.severity]) ?? ''}`}
              >
                {r.severity ?? '—'}
              </span>
            ),
          },
          {
            key: 'bottleCount',
            header: 'Bottles',
            cell: (r) => (
              <span className="font-mono font-bold text-sm text-foreground dark:text-white">
                {r.bottleCount}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <div className="scale-90 origin-left">
                <StatusBadge status={r.status} />
              </div>
            ),
          },
          {
            key: 'actions',
            header: '',
            width: '80px',
            cell: (r) => (
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl h-8 text-xs font-bold gap-1.5"
                onClick={() => router.push(`/dashboard/damage-cases/${r.id}`)}
              >
                <Eye className="h-3.5 w-3.5" />
                Review
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
