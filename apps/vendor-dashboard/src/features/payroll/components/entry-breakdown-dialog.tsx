'use client';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, Skeleton,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { Receipt } from 'lucide-react';
import { StatusBadge } from '../../../components/shared/status-badge';
import { LEDGER_CATEGORY_CONFIG } from '../constants';
import { useEntryBreakdown, type PayrollEntryBucketTotals } from '../hooks/use-monthly-payroll';
import type { CreatableStaffLedgerCategory } from '@water-supply-crm/types';

interface EntryBreakdownDialogProps {
  entryId: string | null;
  onOpenChange: (open: boolean) => void;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const BUCKET_ORDER: Array<{ key: keyof PayrollEntryBucketTotals; label: string }> = [
  { key: 'bonuses', label: 'Bonuses' },
  { key: 'overtime', label: 'Overtime' },
  { key: 'incentives', label: 'Incentives' },
  { key: 'advances', label: 'Advances' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'penalties', label: 'Penalties' },
  { key: 'otherDeductions', label: 'Other Deductions' },
];

/**
 * Row-click detail — this codebase's established "DataTable has no
 * renderExpanded — use a Dialog" convention (mirrors
 * `sheet-crew-cash-section.tsx`'s edit-on-row-click pattern).
 */
export function EntryBreakdownDialog({ entryId, onOpenChange }: EntryBreakdownDialogProps) {
  const { data, isLoading, isError } = useEntryBreakdown(entryId ?? undefined);

  return (
    <Dialog open={!!entryId} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="rounded-3xl max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            Payroll Entry Breakdown
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : isError || !data ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center text-sm text-destructive">
            Failed to load this entry's breakdown.
          </div>
        ) : (
          <div className="space-y-5 py-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-lg font-bold">{data.entry.user.name}</p>
                <p className="text-xs text-muted-foreground">{data.entry.period.periodLabel}</p>
              </div>
              <StatusBadge status={data.entry.status} />
            </div>

            <div className="rounded-2xl border border-border/50 bg-muted/20 divide-y divide-border/50">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-semibold text-muted-foreground">Base Salary</span>
                <span className="font-mono font-bold">₨ {data.entry.baseSalary.toLocaleString()}</span>
              </div>
              {BUCKET_ORDER.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm font-semibold text-muted-foreground">{label}</span>
                  <span
                    className={cn(
                      'font-mono font-bold',
                      data.entry[key] > 0 ? 'text-emerald-500' : data.entry[key] < 0 ? 'text-destructive' : 'text-foreground',
                    )}
                  >
                    {data.entry[key] >= 0 ? '+' : '−'}₨ {Math.abs(data.entry[key]).toLocaleString()}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-semibold text-muted-foreground">Carry Forward In</span>
                <span
                  className={cn(
                    'font-mono font-bold',
                    data.entry.carryForwardIn > 0 ? 'text-emerald-500' : data.entry.carryForwardIn < 0 ? 'text-destructive' : 'text-foreground',
                  )}
                >
                  {data.entry.carryForwardIn >= 0 ? '+' : '−'}₨ {Math.abs(data.entry.carryForwardIn).toLocaleString()}
                </span>
              </div>
              <div
                className={cn(
                  'flex items-center justify-between px-4 py-3.5 rounded-b-2xl',
                  data.entry.finalPayable < 0 ? 'bg-destructive/10' : 'bg-primary/5',
                )}
              >
                <span className="text-sm font-black uppercase tracking-widest">Final Payable</span>
                <span className={cn('font-mono font-black text-lg', data.entry.finalPayable < 0 ? 'text-destructive' : 'text-foreground')}>
                  ₨ {data.entry.finalPayable.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Ledger Entries by Bucket
              </h3>
              {BUCKET_ORDER.every(({ key }) => data.ledgerEntriesByBucket[key].length === 0) ? (
                <p className="text-sm text-muted-foreground">No ledger entries fed this breakdown.</p>
              ) : (
                BUCKET_ORDER.filter(({ key }) => data.ledgerEntriesByBucket[key].length > 0).map(({ key, label }) => (
                  <div key={key} className="space-y-1.5">
                    <p className="text-xs font-bold text-muted-foreground">{label}</p>
                    <div className="rounded-xl border border-border/40 divide-y divide-border/40 overflow-hidden">
                      {data.ledgerEntriesByBucket[key].map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <span className="font-semibold">
                              {LEDGER_CATEGORY_CONFIG[entry.category as CreatableStaffLedgerCategory]?.label ?? entry.category}
                            </span>
                            <span className="text-xs text-muted-foreground ml-2">{formatDate(entry.effectiveDate)}</span>
                            {entry.description && (
                              <p className="text-xs text-muted-foreground truncate">{entry.description}</p>
                            )}
                          </div>
                          <span className={cn('font-mono font-bold shrink-0', entry.amount >= 0 ? 'text-emerald-500' : 'text-destructive')}>
                            {entry.amount >= 0 ? '+' : '−'}₨ {Math.abs(entry.amount).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
