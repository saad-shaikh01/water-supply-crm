import { VehicleDetail } from '../../../../features/fleet/components/vehicle-detail';

interface Props {
  params: Promise<{ vehicleId: string }>;
}

export default async function VehicleDetailPage({ params }: Props) {
  const { vehicleId } = await params;
  return <VehicleDetail vehicleId={vehicleId} />;
}
