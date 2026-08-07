'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Button } from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { CalendarClock, Wallet, ClipboardList, HandCoins, Receipt, AlertCircle } from 'lucide-react';
import { StatusBadge } from '../../../components/shared/status-badge';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { useOpenPayrollPeriod, usePeriodEntries, usePendingLedgerCount } from '../hooks/use-payroll-dashboard';
import { LogLedgerEntryDialog } from './log-ledger-entry-dialog';

export function PayrollDashboard() {
  const { can } = usePermissions();
  const canGeneratePeriod = can('payroll:period_generate');
  const canViewAll = can('payroll:view_all');
  const canLogEntry = can('payroll:ledger_create');

  const { data: period, isLoading: periodLoading, isError: periodError } = useOpenPayrollPeriod(canGeneratePeriod);
  const { data: entries, isLoading: entriesLoading, isError: entriesError } = usePeriodEntries(period?.id, canViewAll);
  const { data: pendingCount, isLoading: pendingLoading, isError: pendingError } = usePendingLedgerCount(canViewAll);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogCategory, setDialogCategory] = useState<'ADVANCE' | 'EXPENSE_REIMBURSEMENT'>('ADVANCE');

  const totalPayable = (entries ?? []).reduce((sum, e) => sum + e.finalPayable, 0);

  const openQuickAction = (category: 'ADVANCE' | 'EXPENSE_REIMBURSEMENT') => {
    setDialogCategory(category);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Period status banner */}
      {!canGeneratePeriod ? (
        <Card className="bg-muted/30 border-border/40">
          <CardContent className="p-4 text-sm text-muted-foreground flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Period status requires additional payroll permissions.
          </CardContent>
        </Card>
      ) : periodLoading ? (
        <Skeleton className="h-20 rounded-2xl" />
      ) : periodError || !period ? (
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="p-4 text-sm text-destructive">Failed to load the current payroll period.</CardContent>
        </Card>
      ) : (
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardContent className="p-5 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <CalendarClock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold">{period.periodLabel}</p>
                <p className="text-xs text-muted-foreground">Current payroll period</p>
              </div>
            </div>
            <StatusBadge status={period.status} />
          </CardContent>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Wallet className="h-3 w-3" /> Total Payable This Period
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!canViewAll ? (
              <p className="text-sm text-muted-foreground">Requires additional payroll permissions.</p>
            ) : entriesLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : entriesError ? (
              <p className="text-sm text-destructive">Failed to load.</p>
            ) : (
              <>
                <div className="text-2xl font-black font-mono">₨ {totalPayable.toLocaleString()}</div>
                <p className="text-[10px] text-muted-foreground mt-1 font-medium">
                  Across {(entries ?? []).length} generated {(entries ?? []).length === 1 ? 'entry' : 'entries'}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <ClipboardList className="h-3 w-3" /> Pending Approvals
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!canViewAll ? (
              <p className="text-sm text-muted-foreground">Requires additional payroll permissions.</p>
            ) : pendingLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : pendingError ? (
              <p className="text-sm text-destructive">Failed to load.</p>
            ) : (
              <>
                <div className={cn('text-2xl font-black font-mono', (pendingCount ?? 0) > 0 ? 'text-amber-500' : 'text-emerald-500')}>
                  {pendingCount ?? 0}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 font-medium">Ledger entries awaiting approval</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick links */}
      {canLogEntry && (
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" className="rounded-xl font-bold gap-2" onClick={() => openQuickAction('ADVANCE')}>
            <HandCoins className="h-4 w-4" /> Log Advance
          </Button>
          <Button variant="outline" className="rounded-xl font-bold gap-2" onClick={() => openQuickAction('EXPENSE_REIMBURSEMENT')}>
            <Receipt className="h-4 w-4" /> Log Expense / Reimbursement
          </Button>
        </div>
      )}

      <LogLedgerEntryDialog open={dialogOpen} onOpenChange={setDialogOpen} defaultCategory={dialogCategory} />
    </div>
  );
}
