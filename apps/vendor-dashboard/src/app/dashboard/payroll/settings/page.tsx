'use client';

import { PageHeader } from '../../../../components/shared/page-header';
import { PayrollSettings } from '../../../../features/payroll/components/payroll-settings';

export default function PayrollSettingsPage() {
  return (
    <div>
      <PageHeader
        title="Payroll Settings"
        description="Configure the attendance/wage cutoff day, and an optional separate cash-deduction window for advances, crew cash, or other categories."
      />
      <PayrollSettings />
    </div>
  );
}
