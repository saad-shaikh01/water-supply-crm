import { CustomerDetail } from '../../../../features/customers/components/customer-detail';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CustomerDetailPage({ params }: Props) {
  const { id } = await params;
  return <CustomerDetail customerId={id} />;
}
