'use client';

import { useState } from 'react';
import { AlertCircle, Calendar, Inbox, X } from 'lucide-react';
import { Button, Input, Label, cn } from '@water-supply-crm/ui';
import { ADJUSTMENT_KINDS, ADJUSTMENT_STATUSES, type AdjustmentKind, type AdjustmentStatus } from '@water-supply-crm/types';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useCustomerAdjustments } from '../hooks/use-customer-adjustments';
import type { CustomerAdjustment } from '../api/customer-adjustments.api';
import { adjustmentKindLabel, directionSign, fmtAdjustmentAmount, fmtAdjustmentDate } from '../format';
import { AdjustmentDetailDialog } from './adjustment-detail-dialog';

const STATUS_LABELS: Record<AdjustmentStatus, string> = { POSTED: 'Posted', VOIDED: 'Voided' };

const SELECT_CLASS =
  'h-9 rounded-xl bg-background/50 border border-border/50 text-xs text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer min-w-[150px]';

interface CustomerAdjustmentsTabProps {
  customerId: string;
}

/**
 * "Charges & Credits" tab on the customer detail page — READ-ONLY (phase 4A): the customer's
 * manual fees, discounts, write-offs, corrections and balance transfers, newest business date
 * first, with type / status / date filters and a detail dialog. Posting and voiding come later.
 *
 * Filters and paging are local state on purpose: the Transactions tab on the same page owns the
 * `page` / `dateFrom` / `dateTo` URL params (nuqs), so binding these to the URL would clash.
 */
export function CustomerAdjustmentsTab({ customerId }: CustomerAdjustmentsTabProps) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [kind, setKind] = useState<AdjustmentKind | ''>('');
  const [status, setStatus] = useState<AdjustmentStatus | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<CustomerAdjustment | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useCustomerAdjustments({
    customerId,
    page,
    limit,
    kind: kind || undefined,
    status: status || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const hasFilters = !!(kind || status || dateFrom || dateTo);

  // Any filter change goes back to the first page.
  const applyFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const clearFilters = () => {
    setKind('');
    setStatus('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold">Charges &amp; Credits</h3>
        <p className="text-xs text-muted-foreground">
          Manual fees, discounts, write-offs, corrections and balance transfers on this account. A charge raises what the
          customer owes; a credit lowers it.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-card/30 p-3 sm:p-4 rounded-2xl border border-border">
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground">Type</Label>
          <select
            aria-label="Type"
            value={kind}
            onChange={(e) => applyFilter(() => setKind(e.target.value as AdjustmentKind | ''))}
            className={SELECT_CLASS}
          >
            <option value="">All types</option>
            {ADJUSTMENT_KINDS.map((k) => (
              <option key={k} value={k} className="bg-background text-foreground dark:text-white">
                {adjustmentKindLabel(k)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground">Status</Label>
          <select
            aria-label="Status"
            value={status}
            onChange={(e) => applyFilter(() => setStatus(e.target.value as AdjustmentStatus | ''))}
            className={SELECT_CLASS}
          >
            <option value="">All statuses</option>
            {ADJUSTMENT_STATUSES.map((s) => (
              <option key={s} value={s} className="bg-background text-foreground dark:text-white">
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground">From</Label>
          <Input
            type="date"
            aria-label="From date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => applyFilter(() => setDateFrom(e.target.value))}
            className="h-9 rounded-xl bg-background/50 border-border/50 text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground">To</Label>
          <Input
            type="date"
            aria-label="To date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => applyFilter(() => setDateTo(e.target.value))}
            className="h-9 rounded-xl bg-background/50 border-border/50 text-xs"
          />
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 rounded-xl text-muted-foreground gap-1.5">
            <X className="h-3.5 w-3.5" /> Clear filters
          </Button>
        )}
      </div>

      {isError ? (
        <div role="alert" className="py-10 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <AlertCircle className="h-8 w-8 text-destructive/70" />
          <p className="font-semibold">Couldn’t load charges &amp; credits.</p>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => refetch()} disabled={isFetching}>
            Try again
          </Button>
        </div>
      ) : !isLoading && rows.length === 0 ? (
        <div className="py-12 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <div className="p-5 rounded-2xl bg-white/[0.01] border border-border">
            <Inbox className="h-8 w-8 text-muted-foreground/40" />
          </div>
          {hasFilters ? (
            <>
              <p className="font-semibold">No charges or credits match your filters.</p>
              <button onClick={clearFilters} className="text-xs text-primary underline hover:no-underline font-bold">
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p className="font-semibold">No charges or credits on this account yet.</p>
              <p className="text-xs max-w-sm">
                Fees, discounts, write-offs and balance transfers posted to this customer will appear here.
              </p>
            </>
          )}
        </div>
      ) : (
        <DataTable
          data={rows}
          isLoading={isLoading}
          page={page}
          limit={limit}
          total={total}
          onPageChange={setPage}
          onLimitChange={(l) => {
            setLimit(l);
            setPage(1);
          }}
          onRowClick={setSelected}
          columns={[
            {
              key: 'date',
              header: 'Date',
              essential: true,
              cell: (r) => (
                <div className="flex items-center gap-2 whitespace-nowrap text-xs font-medium tabular-nums text-muted-foreground/80">
                  <Calendar className="h-3 w-3 shrink-0 text-muted-foreground/80" />
                  {fmtAdjustmentDate(r.effectiveDate)}
                </div>
              ),
            },
            {
              key: 'type',
              header: 'Type',
              essential: true,
              cell: (r) => <span className="text-xs font-bold whitespace-nowrap">{adjustmentKindLabel(r.kind)}</span>,
            },
            {
              key: 'description',
              header: 'Description',
              essential: true,
              cell: (r) => (
                <div className="max-w-[260px]">
                  <p className={cn('text-xs font-semibold truncate', r.status === 'VOIDED' && 'line-through text-muted-foreground')}>
                    {r.title}
                  </p>
                  {r.referenceNo && <p className="text-[10px] font-mono text-muted-foreground truncate">Ref {r.referenceNo}</p>}
                </div>
              ),
            },
            {
              key: 'amount',
              header: 'Amount',
              essential: true,
              cell: (r) => (
                <span
                  className={cn(
                    'font-mono font-bold text-xs whitespace-nowrap',
                    r.direction === 'CHARGE' ? 'text-rose-400' : 'text-emerald-400',
                    r.status === 'VOIDED' && 'line-through opacity-60',
                  )}
                >
                  {directionSign(r.direction)} {fmtAdjustmentAmount(r.amount)}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              essential: true,
              cell: (r) => (
                <div className="scale-90 origin-left">
                  <StatusBadge status={r.status} />
                </div>
              ),
            },
            {
              key: 'by',
              header: 'Posted by',
              essential: true,
              cell: (r) => <span className="text-xs text-muted-foreground">{r.createdBy?.name ?? '—'}</span>,
            },
          ]}
        />
      )}

      <AdjustmentDetailDialog adjustment={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
