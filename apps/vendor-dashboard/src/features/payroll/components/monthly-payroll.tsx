'use client';

import { useState } from 'react';
import { Card, CardContent, Skeleton, Button } from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { CalendarClock, Loader2, RefreshCw, Lock, LockOpen, AlertCircle } from 'lucide-react';
import type { PayrollEntry } from '@water-supply-crm/types';
import { StatusBadge } from '../../../components/shared/status-badge';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { useOpenPayrollPeriod, usePeriodEntries } from '../hooks/use-payroll-dashboard';
import { useGenerateDraft, useApproveEntry, useLockPeriod } from '../hooks/use-monthly-payroll';
import { EntryBreakdownDialog } from './entry-breakdown-dialog';
import { UnlockPeriodDialog } from './unlock-period-dialog';

function amountCell(value: number) {
  if (value === 0) return <span className="font-mono text-muted-foreground">₨ 0</span>;
  return (
    <span className={cn('font-mono font-semibold', value > 0 ? 'text-emerald-500' : 'text-destructive')}>
      {value >= 0 ? '+' : '−'}₨ {Math.abs(value).toLocaleString()}
    </span>
  );
}

/**
 * Monthly Payroll page (§7): one table, one row per employee's PayrollEntry for the
 * current period, generated on demand and locked once approvals are complete (§9
 * steps 7-9). Reuses `useOpenPayrollPeriod`/`usePeriodEntries` from the Payroll
 * Dashboard rather than re-fetching in a parallel shape.
 */
export function MonthlyPayroll() {
  const { can } = usePermissions();
  const canGeneratePeriod = can('payroll:period_generate');
  const canViewAll = can('payroll:view_all');
  const canApprove = can('payroll:entry_approve');
  const canLock = can('payroll:period_lock');
  const canUnlock = can('payroll:period_unlock');

  const { data: period, isLoading: periodLoading, isError: periodError } = useOpenPayrollPeriod(canGeneratePeriod);
  const { data: entries, isLoading: entriesLoading, isError: entriesError } = usePeriodEntries(period?.id, canViewAll);

  const { mutate: generateDraft, isPending: isGenerating } = useGenerateDraft(period?.id);
  const { mutate: approveEntry, isPending: isApproving } = useApproveEntry(period?.id);
  const { mutate: lockPeriod, isPending: isLocking } = useLockPeriod();

  const [breakdownEntryId, setBreakdownEntryId] = useState<string | null>(null);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  if (!canGeneratePeriod) {
    return (
      <Card className="bg-muted/30 border-border/40">
        <CardContent className="p-4 text-sm text-muted-foreground flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Monthly Payroll requires additional payroll permissions.
        </CardContent>
      </Card>
    );
  }

  if (periodLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (periodError || !period) {
    return (
      <Card className="bg-destructive/5 border-destructive/20">
        <CardContent className="p-4 text-sm text-destructive">Failed to load the current payroll period.</CardContent>
      </Card>
    );
  }

  const list = entries ?? [];
  const canLockPeriod = canLock && (period.status === 'OPEN' || period.status === 'REVIEW');
  const canUnlockPeriod = canUnlock && period.status === 'LOCKED';

  const handleApprove = (entry: PayrollEntry) => {
    setApprovingId(entry.id);
    approveEntry({ id: entry.id, version: entry.version }, { onSettled: () => setApprovingId(null) });
  };

  return (
    <div className="space-y-6">
      {/* Period status + bulk actions */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardContent className="p-5 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <CalendarClock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold">{period.periodLabel}</p>
              <p className="text-xs text-muted-foreground">Current payroll period</p>
            </div>
            <StatusBadge status={period.status} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="rounded-xl font-bold gap-2"
              onClick={() => generateDraft()}
              disabled={isGenerating || period.status === 'LOCKED' || period.status === 'PAID'}
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Generate Draft
            </Button>
            {canLockPeriod && (
              <Button
                variant="destructive"
                className="rounded-xl font-bold gap-2"
                onClick={() => setLockConfirmOpen(true)}
                disabled={isLocking || list.length === 0}
              >
                <Lock className="h-4 w-4" />
                Lock Period
              </Button>
            )}
            {canUnlockPeriod && (
              <Button
                variant="outline"
                className="rounded-xl font-bold gap-2 border-destructive/40 text-destructive hover:bg-destructive/5"
                onClick={() => setUnlockDialogOpen(true)}
              >
                <LockOpen className="h-4 w-4" />
                Unlock Period
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Entries table */}
      {!canViewAll ? (
        <Card className="bg-muted/30 border-border/40">
          <CardContent className="p-4 text-sm text-muted-foreground flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Viewing every employee's entries requires additional payroll permissions.
          </CardContent>
        </Card>
      ) : entriesError ? (
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="p-4 text-sm text-destructive">Failed to load payroll entries for this period.</CardContent>
        </Card>
      ) : (
        <DataTable<PayrollEntry>
          data={entries}
          isLoading={entriesLoading}
          emptyMessage="No payroll entries generated yet — click Generate Draft to compute this period's payroll."
          onRowClick={(row) => setBreakdownEntryId(row.id)}
          columns={[
            { key: 'employee', header: 'Employee', cell: (r) => <span className="font-bold">{r.user.name}</span> },
            { key: 'baseSalary', header: 'Base', cell: (r) => <span className="font-mono">₨ {r.baseSalary.toLocaleString()}</span> },
            { key: 'bonuses', header: 'Bonuses', cell: (r) => amountCell(r.bonuses) },
            { key: 'overtime', header: 'Overtime', cell: (r) => amountCell(r.overtime) },
            { key: 'incentives', header: 'Incentives', cell: (r) => amountCell(r.incentives) },
            { key: 'advances', header: 'Advances', cell: (r) => amountCell(r.advances) },
            { key: 'expenses', header: 'Expenses', cell: (r) => amountCell(r.expenses) },
            { key: 'penalties', header: 'Penalties', cell: (r) => amountCell(r.penalties) },
            { key: 'otherDeductions', header: 'Other Deductions', cell: (r) => amountCell(r.otherDeductions) },
            {
              key: 'finalPayable',
              header: 'Final Payable',
              cell: (r) => (
                <span className={cn('font-mono font-black', r.finalPayable < 0 ? 'text-destructive' : 'text-foreground')}>
                  ₨ {r.finalPayable.toLocaleString()}
                  {r.finalPayable < 0 && <AlertCircle className="inline h-3.5 w-3.5 ml-1.5 -mt-0.5" />}
                </span>
              ),
            },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions',
              header: 'Actions',
              cell: (r) =>
                canApprove && r.status === 'DRAFT' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg h-7 text-xs font-bold"
                    disabled={isApproving && approvingId === r.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleApprove(r);
                    }}
                  >
                    {isApproving && approvingId === r.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Approve
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                ),
            },
          ]}
        />
      )}

      <EntryBreakdownDialog entryId={breakdownEntryId} onOpenChange={(o) => !o && setBreakdownEntryId(null)} />

      <ConfirmDialog
        open={lockConfirmOpen}
        onOpenChange={setLockConfirmOpen}
        title="Lock Payroll Period"
        description={`Locking "${period.periodLabel}" is a one-way gate into Settlement. Every entry must already be APPROVED — this cannot be undone from here (only a separately audited Unlock, for genuine mistakes, can reopen it). Continue?`}
        onConfirm={() => lockPeriod(period.id, { onSuccess: () => setLockConfirmOpen(false) })}
        isLoading={isLocking}
        confirmLabel="Lock Period"
        variant="destructive"
      />

      <UnlockPeriodDialog open={unlockDialogOpen} onOpenChange={setUnlockDialogOpen} periodId={period.id} />
    </div>
  );
}
