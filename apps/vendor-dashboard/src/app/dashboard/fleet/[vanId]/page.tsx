import { VehicleDetail } from '../../../../features/fleet/components/vehicle-detail';

interface Props {
  params: Promise<{ vanId: string }>;
}

export default async function VehicleDetailPage({ params }: Props) {
  const { vanId } = await params;
  return <VehicleDetail vanId={vanId} />;
}
