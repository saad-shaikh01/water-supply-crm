'use client';

import { Inbox } from 'lucide-react';
import {
  Badge, Card, CardContent, Skeleton, DataTablePagination, cn,
} from '@water-supply-crm/ui';
import { useExpenseCenterTimeline } from '../hooks/use-expense-center';
import { domainMeta } from '../constants';
import type { ExpenseCenterRow } from '../api/expense-center.api';

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

function TimelineRow({ row }: { row: ExpenseCenterRow }) {
  const meta = domainMeta(row.domain);

  // Everything the row can say about *who* the money moved through, collapsed
  // into one muted line so the amount stays the only loud thing on the right.
  // The van plate is omitted here — it already has its own chip above.
  const metadata = [
    row.employeeName,
    row.recordedByName ? `by ${row.recordedByName}` : null,
  ].filter(Boolean) as string[];

  // Phase 2 (§07): clicking a row will route to the owning domain's own edit
  // form (Expense / Payroll ledger / Crew Cash). Read-only for now.
  return (
    <Card className="bg-card/50 border-border/40 rounded-2xl">
      <CardContent className="p-3 flex items-center gap-3">
        <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', meta.solid)} aria-hidden />

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border-none', meta.color)}>
              {row.categoryLabel}
            </Badge>
            <Badge variant="secondary" className="text-[10px] font-medium">{row.sourceBadge}</Badge>
            {row.vanPlateNumber && (
              <Badge variant="secondary" className="text-[10px] font-mono">{row.vanPlateNumber}</Badge>
            )}
          </div>
          <p className="text-xs font-semibold truncate mt-1">{row.title}</p>
          {metadata.length > 0 && (
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{metadata.join(' · ')}</p>
          )}
        </div>

        <div className="text-right shrink-0">
          {/* Every row renders in the same cost tone regardless of `costSign`.
              A payroll CREDIT (bonus / reimbursement / paid leave) is still
              money leaving the business — colouring it green would read as
              revenue. The direction is carried by the tag below instead. */}
          <p className="font-mono font-black text-sm text-destructive">
            ₨ {Number(row.amount).toLocaleString()}
          </p>
          {row.costSign === 'CREDIT' && (
            <p className="text-[10px] text-muted-foreground lowercase">credit to employee</p>
          )}
          <p className="text-[10px] text-muted-foreground">{fmtDate(row.date)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function ExpenseTimeline() {
  const { data, isLoading, page, setPage, limit, setLimit } = useExpenseCenterTimeline();

  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Expense Timeline</h3>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="bg-card/30 border-border/40 rounded-2xl">
          <CardContent className="p-10 flex flex-col items-center justify-center gap-3">
            <div className="p-5 rounded-2xl bg-white/[0.01] border border-border">
              <Inbox className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-bold text-muted-foreground/40">No expenses recorded for this period</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <TimelineRow key={`${row.sourceType}:${row.id}`} row={row} />
          ))}
        </div>
      )}

      {total > 0 && (
        <div className="sticky bottom-4 z-30">
          <div className="mx-auto max-w-fit sm:max-w-none">
            <div className="bg-background/95 dark:bg-[#0a0a0f]/80 backdrop-blur-2xl border border-border rounded-2xl p-1 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.2)] overflow-hidden">
              <DataTablePagination
                page={page}
                limit={limit}
                total={total}
                onPageChange={(p) => void setPage(p)}
                onLimitChange={(l) => { void setLimit(l); void setPage(1); }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
