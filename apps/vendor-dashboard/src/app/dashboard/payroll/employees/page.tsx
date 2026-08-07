'use client';

import { PageHeader } from '../../../../components/shared/page-header';
import { EmployeesList } from '../../../../features/payroll/components/employees-list';

export default function PayrollEmployeesPage() {
  return (
    <div>
      <PageHeader
        title="Employees"
        description="Open an employee's Financial Profile to review balances, salary, and log ledger entries."
      />
      <EmployeesList />
    </div>
  );
}
