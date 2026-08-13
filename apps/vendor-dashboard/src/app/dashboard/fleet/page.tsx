'use client';

import { PageHeader } from '../../../components/shared/page-header';
import { FleetOverviewCards } from '../../../features/fleet/components/fleet-overview-cards';
import { VehicleList } from '../../../features/fleet/components/vehicle-list';

export default function FleetPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Fleet" description="Vehicle health, maintenance, fuel, and cost — per vehicle and fleet-wide." />
      <FleetOverviewCards />
      <VehicleList />
    </div>
  );
}
