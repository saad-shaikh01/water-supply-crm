'use client';

import { PageHeader } from '../../../components/shared/page-header';
import { PayrollDashboard } from '../../../features/payroll/components/payroll-dashboard';

export default function PayrollPage() {
  return (
    <div>
      <PageHeader
        title="Payroll"
        description="Current period status, total payable, and pending ledger approvals at a glance."
      />
      <PayrollDashboard />
    </div>
  );
}
