'use client';

import { PageHeader } from '../../../../components/shared/page-header';
import { MonthlyPayroll } from '../../../../features/payroll/components/monthly-payroll';

export default function MonthlyPayrollPage() {
  return (
    <div>
      <PageHeader
        title="Monthly Payroll"
        description="Generate this period's draft, review each employee's breakdown, approve entries, and lock the period."
      />
      <MonthlyPayroll />
    </div>
  );
}
