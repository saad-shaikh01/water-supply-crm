'use client';

import { useRouter } from 'next/navigation';
import { Calendar, Eye } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useDiscrepancyCases } from '../hooks/use-discrepancy-cases';
import type { DiscrepancyCaseStatus, DiscrepancyType } from '../api/discrepancy-cases.api';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'REPORTED', label: 'Reported' },
  { value: 'RESOLVED', label: 'Resolved' },
];

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Types' },
  { value: 'BOTTLE', label: 'Bottle' },
  { value: 'EMPTY', label: 'Empty' },
  { value: 'CASH', label: 'Cash' },
];

const TYPE_COLORS: Record<string, string> = {
  BOTTLE: 'bg-blue-500/10 text-blue-500 border border-blue-500/20',
  EMPTY: 'bg-cyan-500/10 text-cyan-500 border border-cyan-500/20',
  CASH: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20',
};

function formatMagnitude(row: { type: DiscrepancyType; reportedQuantity?: number | null; reportedAmount?: number | null }) {
  if (row.type === 'CASH') {
    const amt = row.reportedAmount ?? 0;
    return `₨${Math.abs(amt).toLocaleString()} ${amt > 0 ? 'short' : 'over'}`;
  }
  const qty = row.reportedQuantity ?? 0;
  return `${qty > 0 ? '+' : ''}${qty} bottle${Math.abs(qty) === 1 ? '' : 's'}`;
}

export function DiscrepancyCasesList() {
  const router = useRouter();

  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [type, setType] = useQueryState('type', parseAsString.withDefault(''));
  // Deep-link filter only (no UI control for it) — set by the "Review" banner
  // on a closed sheet with multiple open discrepancy cases (sheet-detail.tsx).
  const [dailySheetId] = useQueryState('dailySheetId', parseAsString.withDefault(''));

  const query = {
    page,
    limit,
    status: status ? (status as DiscrepancyCaseStatus) : undefined,
    type: type ? (type as DiscrepancyType) : undefined,
    dailySheetId: dailySheetId || undefined,
  };

  const { data, isLoading } = useDiscrepancyCases(query);

  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 bg-card/30 p-3 sm:p-4 rounded-2xl border border-border">
        <div className="flex items-center gap-2 flex-wrap flex-1">
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

          <select
            value={type}
            onChange={(e) => { setType(e.target.value || null); resetPage(); }}
            className="h-9 sm:h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 pr-8 outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer min-w-[140px]"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-background text-foreground dark:text-white">
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!isLoading && rows.length === 0 && (
        <div className="py-12 text-center text-muted-foreground space-y-2">
          {(status || type) ? (
            <>
              <p className="font-semibold">No results match your filters.</p>
              <button
                onClick={() => { setStatus(null); setType(null); resetPage(); }}
                className="text-xs text-primary underline hover:no-underline font-bold"
              >
                Clear filters
              </button>
            </>
          ) : (
            <p className="font-semibold">No discrepancy cases yet — every closed sheet reconciled clean.</p>
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
        emptyMessage="No discrepancy cases found."
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
            key: 'van',
            header: 'Van',
            cell: (r) => <span className="text-sm font-medium">{r.dailySheet?.van?.plateNumber ?? '—'}</span>,
          },
          {
            key: 'driver',
            header: 'Driver',
            cell: (r) => <span className="text-sm font-medium">{r.driver?.name ?? '—'}</span>,
          },
          {
            key: 'type',
            header: 'Type',
            cell: (r) => (
              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold ${TYPE_COLORS[r.type] ?? ''}`}>
                {r.type}
              </span>
            ),
          },
          {
            key: 'magnitude',
            header: 'Gap',
            cell: (r) => <span className="font-mono font-bold text-sm text-foreground dark:text-white">{formatMagnitude(r)}</span>,
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
                onClick={() => router.push(`/dashboard/discrepancy-cases/${r.id}`)}
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
