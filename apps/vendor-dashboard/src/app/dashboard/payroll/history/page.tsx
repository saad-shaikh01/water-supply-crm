'use client';

import { PageHeader } from '../../../../components/shared/page-header';
import { PayrollHistory } from '../../../../features/payroll/components/payroll-history';

export default function PayrollHistoryPage() {
  return (
    <div>
      <PageHeader
        title="Payroll History"
        description="Every payroll period for this vendor, newest first — click a period to view its full breakdown."
      />
      <PayrollHistory />
    </div>
  );
}
