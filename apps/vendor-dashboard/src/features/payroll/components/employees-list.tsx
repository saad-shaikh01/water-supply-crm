'use client';

import { useRouter } from 'next/navigation';
import { Skeleton } from '@water-supply-crm/ui';
import { Inbox } from 'lucide-react';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useEligibleEmployees } from '../hooks/use-eligible-employees';

/**
 * Payroll's own Employees list — distinct from `/dashboard/users` (which manages
 * accounts/RBAC for every role including CUSTOMER/VENDOR_ADMIN and has no detail
 * route to extend). This one is scoped to payroll-eligible staff and links straight
 * into each employee's Financial Profile.
 */
export function EmployeesList() {
  const router = useRouter();
  const { data: employees, isLoading, isError } = useEligibleEmployees();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center text-sm text-destructive">
        Failed to load employees.
      </div>
    );
  }

  if (!employees?.length) {
    return (
      <div className="rounded-2xl border border-border bg-white/[0.02] p-10 text-center">
        <Inbox className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm font-bold text-muted-foreground/60">No payroll-eligible employees found.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-white/[0.02] backdrop-blur-2xl overflow-hidden divide-y divide-border/50">
      {employees.map((emp) => (
        <button
          key={emp.id}
          type="button"
          onClick={() => router.push(`/dashboard/payroll/employees/${emp.id}`)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-white/[0.04] transition-colors"
        >
          <div>
            <p className="text-sm font-bold">{emp.name}</p>
            <p className="text-xs text-muted-foreground">{emp.email}</p>
          </div>
          <StatusBadge status={emp.role} />
        </button>
      ))}
    </div>
  );
}
