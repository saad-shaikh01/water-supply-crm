import { EmployeeFinancialProfile } from '../../../../../features/payroll/components/employee-financial-profile';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PayrollEmployeeDetailPage({ params }: Props) {
  const { id } = await params;
  return <EmployeeFinancialProfile employeeId={id} />;
}
