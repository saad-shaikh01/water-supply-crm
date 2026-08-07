'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@water-supply-crm/ui';
import { AlertCircle } from 'lucide-react';
import type { PayrollPeriod } from '@water-supply-crm/types';
import { StatusBadge } from '../../../components/shared/status-badge';
import { DataTable } from '../../../components/shared/data-table';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { usePayrollPeriods } from '../hooks/use-payroll-history';

function formatDate(d: string) {
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Payroll History (§12): every payroll period for the vendor, newest first,
 * browsable. Deliberately omits a per-period "total payable" column — computing
 * that would mean fetching every period's entries just to sum `finalPayable` on
 * a list page (an N+1 fetch pattern not worth it here); the total is already one
 * click away since each row opens that period's full Monthly Payroll breakdown.
 * Clicking a row reuses `MonthlyPayroll` scoped to that period id rather than a
 * second table component (see `MonthlyPayrollProps.periodId`).
 */
export function PayrollHistory() {
  const router = useRouter();
  const { can } = usePermissions();
  const canViewAll = can('payroll:view_all');

  const { data: periods, isLoading, isError } = usePayrollPeriods(canViewAll);

  if (!canViewAll) {
    return (
      <Card className="bg-muted/30 border-border/40">
        <CardContent className="p-4 text-sm text-muted-foreground flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Payroll History requires additional payroll permissions.
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="bg-destructive/5 border-destructive/20">
        <CardContent className="p-4 text-sm text-destructive">Failed to load payroll periods.</CardContent>
      </Card>
    );
  }

  return (
    <DataTable<PayrollPeriod>
      data={periods}
      isLoading={isLoading}
      emptyMessage="No payroll periods yet — one is created automatically the first time Monthly Payroll opens."
      onRowClick={(row) => router.push(`/dashboard/payroll/monthly/${row.id}`)}
      columns={[
        { key: 'periodLabel', header: 'Period', cell: (r) => <span className="font-bold">{r.periodLabel}</span> },
        {
          key: 'dateRange',
          header: 'Date Range',
          cell: (r) => (
            <span className="text-sm text-muted-foreground">
              {formatDate(r.startDate)} – {formatDate(r.endDate)}
            </span>
          ),
        },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]}
    />
  );
}
