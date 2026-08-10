'use client';

import { useState } from 'react';
import { Card, CardContent, Skeleton, Button } from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { CalendarClock, Loader2, RefreshCw, Lock, LockOpen, AlertCircle, Landmark, X } from 'lucide-react';
import type { PayrollEntry } from '@water-supply-crm/types';
import { StatusBadge } from '../../../components/shared/status-badge';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { useOpenPayrollPeriod, usePeriodEntries } from '../hooks/use-payroll-dashboard';
import { useGenerateDraft, useApproveEntry, useLockPeriod, type GenerateDraftResult } from '../hooks/use-monthly-payroll';
import { useHistoricalPeriod } from '../hooks/use-payroll-history';
import { EntryBreakdownDialog } from './entry-breakdown-dialog';
import { UnlockPeriodDialog } from './unlock-period-dialog';
import { SettlementDialog } from './settlement-dialog';
import { SalaryStructureDialog } from './salary-structure-dialog';

function amountCell(value: number) {
  if (value === 0) return <span className="font-mono text-muted-foreground">₨ 0</span>;
  return (
    <span className={cn('font-mono font-semibold', value > 0 ? 'text-emerald-500' : 'text-destructive')}>
      {value >= 0 ? '+' : '−'}₨ {Math.abs(value).toLocaleString()}
    </span>
  );
}

export interface MonthlyPayrollProps {
  /**
   * When provided, shows this specific (typically LOCKED/PAID, historical) period
   * instead of the vendor's current OPEN one — the Payroll History (§12) "click a
   * period row" destination. Reuses this same table/dialogs rather than a second
   * component; period-lifecycle actions (Generate Draft/Lock) naturally no-op or
   * hide themselves because they're already gated on `period.status`, which for a
   * historical period is never OPEN/REVIEW.
   */
  periodId?: string;
}

/**
 * Monthly Payroll page (§7): one table, one row per employee's PayrollEntry for the
 * current period, generated on demand and locked once approvals are complete (§9
 * steps 7-9). Reuses `useOpenPayrollPeriod`/`usePeriodEntries` from the Payroll
 * Dashboard rather than re-fetching in a parallel shape.
 */
export function MonthlyPayroll({ periodId }: MonthlyPayrollProps = {}) {
  const isHistorical = !!periodId;
  const { can } = usePermissions();
  const canGeneratePeriod = can('payroll:period_generate');
  const canViewAll = can('payroll:view_all');
  const canApprove = can('payroll:entry_approve');
  const canLock = can('payroll:period_lock');
  const canUnlock = can('payroll:period_unlock');
  const canSettle = can('payroll:settlement_record');
  const canManageSalary = can('payroll:salary_structure_manage');

  const {
    data: openPeriod,
    isLoading: openPeriodLoading,
    isError: openPeriodError,
  } = useOpenPayrollPeriod(canGeneratePeriod && !isHistorical);
  const {
    data: historicalPeriod,
    isLoading: historicalPeriodLoading,
    isError: historicalPeriodError,
  } = useHistoricalPeriod(periodId, canViewAll && isHistorical);

  const period = isHistorical ? historicalPeriod : openPeriod;
  const periodLoading = isHistorical ? historicalPeriodLoading : openPeriodLoading;
  const periodError = isHistorical ? historicalPeriodError : openPeriodError;

  const { data: entries, isLoading: entriesLoading, isError: entriesError } = usePeriodEntries(period?.id, canViewAll);

  const { mutate: generateDraft, isPending: isGenerating } = useGenerateDraft(period?.id);
  const { mutate: approveEntry, isPending: isApproving } = useApproveEntry(period?.id);
  const { mutate: lockPeriod, isPending: isLocking } = useLockPeriod();

  const [breakdownEntryId, setBreakdownEntryId] = useState<string | null>(null);
  const [settlementEntryId, setSettlementEntryId] = useState<string | null>(null);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  // Populated from the last Generate Draft response (doc §5 edge case) — not persisted,
  // just a transient "here's who got skipped just now" banner until dismissed or fixed.
  const [missingSalaryEmployees, setMissingSalaryEmployees] = useState<GenerateDraftResult['skippedMissingSalaryStructure']>([]);
  const [salaryDialogEmployee, setSalaryDialogEmployee] = useState<{ id: string; name: string } | null>(null);

  if (isHistorical ? !canViewAll : !canGeneratePeriod) {
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
        <CardContent className="p-4 text-sm text-destructive">
          {isHistorical ? 'Failed to load this payroll period.' : 'Failed to load the current payroll period.'}
        </CardContent>
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
              <p className="text-xs text-muted-foreground">{isHistorical ? 'Historical payroll period' : 'Current payroll period'}</p>
            </div>
            <StatusBadge status={period.status} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="rounded-xl font-bold gap-2"
              onClick={() =>
                generateDraft(undefined, {
                  onSuccess: (result) => setMissingSalaryEmployees(result.skippedMissingSalaryStructure),
                })
              }
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

      {/* Missing-salary-structure warning (doc §5 edge case) — Generate Draft excludes these
          employees rather than silently defaulting to ₨0; "Set Salary" opens the dialog for
          that employee directly, no navigation away from this page required. */}
      {missingSalaryEmployees.length > 0 && (
        <Card className="bg-amber-500/5 border-amber-500/20">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-amber-600 uppercase tracking-widest flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5" />
                {missingSalaryEmployees.length} employee{missingSalaryEmployees.length === 1 ? '' : 's'} skipped — missing salary structure
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => setMissingSalaryEmployees([])}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            {canManageSalary && (
              <div className="flex flex-wrap gap-2">
                {missingSalaryEmployees.map((e) => (
                  <Button
                    key={e.userId}
                    variant="outline"
                    size="sm"
                    className="rounded-lg h-7 text-xs font-bold gap-1.5 border-amber-500/30"
                    onClick={() => setSalaryDialogEmployee({ id: e.userId, name: e.name })}
                  >
                    <Landmark className="h-3 w-3" />
                    {e.name} — Set Salary
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
              cell: (r) => {
                const showApprove = canApprove && r.status === 'DRAFT';
                const showSettle = canSettle && (r.status === 'LOCKED' || r.status === 'SETTLED');
                if (!showApprove && !showSettle) {
                  return <span className="text-xs text-muted-foreground">—</span>;
                }
                return (
                  <div className="flex items-center gap-2">
                    {showApprove && (
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
                    )}
                    {showSettle && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-lg h-7 text-xs font-bold gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSettlementEntryId(r.id);
                        }}
                      >
                        <Landmark className="h-3 w-3" />
                        Settle
                      </Button>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      )}

      <EntryBreakdownDialog entryId={breakdownEntryId} onOpenChange={(o) => !o && setBreakdownEntryId(null)} />

      <SettlementDialog entryId={settlementEntryId} onOpenChange={(o) => !o && setSettlementEntryId(null)} />

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

      <SalaryStructureDialog
        employee={salaryDialogEmployee}
        onOpenChange={(o) => !o && setSalaryDialogEmployee(null)}
        onSuccess={(employeeId) =>
          setMissingSalaryEmployees((prev) => prev.filter((e) => e.userId !== employeeId))
        }
      />
    </div>
  );
}
