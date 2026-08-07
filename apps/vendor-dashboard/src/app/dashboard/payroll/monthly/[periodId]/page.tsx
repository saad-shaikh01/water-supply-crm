import { PageHeader } from '../../../../../components/shared/page-header';
import { MonthlyPayroll } from '../../../../../features/payroll/components/monthly-payroll';

interface Props {
  params: Promise<{ periodId: string }>;
}

export default async function HistoricalPayrollPeriodPage({ params }: Props) {
  const { periodId } = await params;
  return (
    <div>
      <PageHeader
        title="Monthly Payroll"
        description="Historical period — breakdown, snapshot detail, and settlement history for a past payroll period."
      />
      <MonthlyPayroll periodId={periodId} />
    </div>
  );
}
