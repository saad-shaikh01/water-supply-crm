'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Calendar, Eye, X, SlidersHorizontal, Search, ExternalLink } from 'lucide-react';
import { Badge, Button, Input, Label } from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { DataTable } from '../../../components/shared/data-table';
import { CustomerLink } from '../../../components/shared/customer-link';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useDamageCases, useDamageCaseReporters, useDamageCaseSummary } from '../hooks/use-damage-cases';
import type { DamageCaseStatus, DamageCaseType, DamageSeverity } from '../api/damage-cases.api';

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

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Damage & Lost' },
  { value: 'DAMAGE', label: 'Damage' },
  { value: 'LOST', label: 'Lost Bottle' },
];

const SEVERITY_COLORS: Record<string, string> = {
  MINOR: 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20',
  MODERATE: 'bg-orange-500/10 text-orange-500 border border-orange-500/20',
  SEVERE: 'bg-red-500/10 text-red-500 border border-red-500/20',
};

const SELECT_CLASS =
  'h-9 sm:h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 pr-8 outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer min-w-[140px]';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function StatCard({
  label,
  value,
  hint,
  active,
  tone,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  active?: boolean;
  tone?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'text-left rounded-2xl border bg-card/30 p-3 sm:p-4 transition-colors',
        onClick && 'hover:border-primary/40 cursor-pointer',
        active ? 'border-primary bg-primary/5' : 'border-border',
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{label}</p>
      <p className={cn('text-xl sm:text-2xl font-black tabular-nums mt-1', tone ?? 'text-foreground dark:text-white')}>
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground/70 mt-0.5">{hint}</p>}
    </button>
  );
}

export function DamageCasesList() {
  const router = useRouter();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [severity, setSeverity] = useQueryState('severity', parseAsString.withDefault(''));
  const [caseType, setCaseType] = useQueryState('caseType', parseAsString.withDefault(''));
  const [salesmanId, setSalesmanId] = useQueryState('salesmanId', parseAsString.withDefault(''));
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
    caseType: caseType ? (caseType as DamageCaseType) : undefined,
    salesmanId: salesmanId || undefined,
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const { data, isLoading } = useDamageCases(query);
  const { data: summary } = useDamageCaseSummary(query);
  const { data: reporters = [] } = useDamageCaseReporters();

  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  const resetPage = () => setPage(1);
  const salesmanName = reporters.find((r) => r.id === salesmanId)?.name;

  const activeChips = [
    status ? { label: `Status: ${STATUS_OPTIONS.find((o) => o.value === status)?.label}`, clear: () => { setStatus(null); resetPage(); } } : null,
    severity ? { label: `Severity: ${severity}`, clear: () => { setSeverity(null); resetPage(); } } : null,
    caseType ? { label: `Type: ${TYPE_OPTIONS.find((o) => o.value === caseType)?.label}`, clear: () => { setCaseType(null); resetPage(); } } : null,
    salesmanId ? { label: `Salesman: ${salesmanName ?? '...'}`, clear: () => { setSalesmanId(null); resetPage(); } } : null,
    search ? { label: `Search: ${search}`, clear: () => { setSearch(null); resetPage(); } } : null,
    (dateFrom || dateTo) ? { label: `Date: ${dateFrom || '...'} to ${dateTo || '...'}`, clear: () => { setDateFrom(null); setDateTo(null); resetPage(); } } : null,
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  const activeFilterCount = [severity, caseType, dateFrom || dateTo].filter(Boolean).length;
  const hasAnyFilter = activeChips.length > 0;

  const clearAll = () => {
    setStatus(null);
    setSeverity(null);
    setCaseType(null);
    setSalesmanId(null);
    setSearch(null);
    setDateFrom(null);
    setDateTo(null);
    resetPage();
  };

  const pickStatus = (value: string) => {
    setStatus(status === value ? null : value || null);
    resetPage();
  };

  const byStatus = summary?.byStatus ?? {};
  const needsAction = (byStatus.REPORTED ?? 0) + (byStatus.UNDER_REVIEW ?? 0);

  return (
    <div className="space-y-4">
      {/* KPI cards — click to filter by status */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label="Needs Action"
          value={needsAction}
          hint="Reported + under review"
          tone={needsAction > 0 ? 'text-amber-500' : undefined}
          active={status === 'REPORTED'}
          onClick={() => pickStatus('REPORTED')}
        />
        <StatCard
          label="Under Review"
          value={byStatus.UNDER_REVIEW ?? 0}
          active={status === 'UNDER_REVIEW'}
          onClick={() => pickStatus('UNDER_REVIEW')}
        />
        <StatCard
          label="Charged"
          value={`₨${(summary?.chargedAmount ?? 0).toLocaleString()}`}
          hint={`${byStatus.CHARGED ?? 0} cases`}
          tone="text-emerald-500"
          active={status === 'CHARGED'}
          onClick={() => pickStatus('CHARGED')}
        />
        <StatCard
          label="Waived"
          value={byStatus.WAIVED ?? 0}
          active={status === 'WAIVED'}
          onClick={() => pickStatus('WAIVED')}
        />
        <StatCard
          label="Bottles (filtered)"
          value={summary?.totalBottles ?? 0}
          hint={`${summary?.total ?? 0} cases`}
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 bg-card/30 p-3 sm:p-4 rounded-2xl border border-border">
        <div className="flex items-center gap-2 flex-wrap flex-1 w-full">
          {/* Search: customer name / code / phone */}
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search customer name, code or phone..."
              value={search}
              onChange={(e) => { setSearch(e.target.value || null); resetPage(); }}
              className="h-9 sm:h-10 w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white placeholder:text-muted-foreground pl-9 pr-3 outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Salesman — only people who actually reported a case */}
          <select
            value={salesmanId}
            onChange={(e) => { setSalesmanId(e.target.value || null); resetPage(); }}
            className={SELECT_CLASS}
            aria-label="Salesman"
          >
            <option value="" className="bg-background text-foreground dark:text-white">All Salesmen</option>
            {reporters.map((r) => (
              <option key={r.id} value={r.id} className="bg-background text-foreground dark:text-white">
                {r.name} ({r.caseCount})
              </option>
            ))}
          </select>

          {/* Status select */}
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value || null); resetPage(); }}
            className={SELECT_CLASS}
            aria-label="Status"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-background text-foreground dark:text-white">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* More filters (severity, type, date range) */}
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

      {/* Extra filters (shown when open) */}
      {filtersOpen && (
        <div className="flex flex-wrap items-end gap-4 p-4 rounded-2xl border border-border bg-card/20">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Severity</Label>
            <select
              value={severity}
              onChange={(e) => { setSeverity(e.target.value || null); resetPage(); }}
              className={SELECT_CLASS}
            >
              {SEVERITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-background text-foreground dark:text-white">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Case Type</Label>
            <select
              value={caseType}
              onChange={(e) => { setCaseType(e.target.value || null); resetPage(); }}
              className={SELECT_CLASS}
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-background text-foreground dark:text-white">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">From Date</Label>
            <Input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => { setDateFrom(e.target.value || null); resetPage(); }}
              className="h-10 rounded-xl bg-background/50 border-border text-sm w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">To Date</Label>
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
          {hasAnyFilter ? (
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
        tableId="damage-cases-list-v2"
        onRowClick={(r) => router.push(`/dashboard/damage-cases/${r.id}`)}
        columns={[
          {
            key: 'date',
            header: 'Reported',
            cell: (r) => (
              <div className="flex items-center gap-2 text-muted-foreground/80 whitespace-nowrap">
                <Calendar className="h-3 w-3 shrink-0" />
                <span className="text-xs font-medium tabular-nums">{fmtDate(r.createdAt)}</span>
              </div>
            ),
          },
          {
            key: 'customer',
            essential: true,
            header: 'Customer',
            cell: (r) => (
              <div className="flex flex-col min-w-0 max-w-[180px]" onClick={(e) => e.stopPropagation()}>
                <CustomerLink id={r.customer?.id} name={r.customer?.name} className="font-bold text-sm text-foreground dark:text-white truncate" />
                {r.customer?.customerCode && (
                  <span className="text-[10px] text-muted-foreground/60 font-mono">{r.customer.customerCode}</span>
                )}
              </div>
            ),
          },
          {
            key: 'salesman',
            header: 'Salesman',
            cell: (r) => <span className="text-sm font-medium">{r.salesman?.name ?? '—'}</span>,
          },
          {
            key: 'van',
            header: 'Van',
            cell: (r) => <span className="text-xs font-mono">{r.van?.plateNumber ?? '—'}</span>,
          },
          {
            key: 'sheet',
            header: 'Daily Sheet',
            cell: (r) =>
              r.dailySheet ? (
                <Link
                  href={`/dashboard/daily-sheets/${r.dailySheet.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline whitespace-nowrap"
                >
                  {fmtDate(r.dailySheet.date)}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              ),
          },
          {
            key: 'caseType',
            header: 'Type',
            cell: (r) =>
              r.caseType === 'LOST' ? (
                <span className="inline-flex px-2 py-0.5 rounded-lg text-[11px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20">Lost</span>
              ) : (
                <span className="inline-flex px-2 py-0.5 rounded-lg text-[11px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">Damage</span>
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
            key: 'chargeAmount',
            header: 'Charged',
            cell: (r) =>
              r.chargeAmount != null ? (
                <span className="font-mono text-sm text-emerald-500">₨{r.chargeAmount.toLocaleString()}</span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
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
            essential: true,
            header: '',
            width: '80px',
            cell: (r) => (
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl h-8 text-xs font-bold gap-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/dashboard/damage-cases/${r.id}`);
                }}
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
