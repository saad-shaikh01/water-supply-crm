'use client';

import { Loader2, Truck } from 'lucide-react';
import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from '@water-supply-crm/ui';
import { useVehicle, useVehicleCostSummary } from '../hooks/use-fleet';
import { VehicleOverviewTab } from './vehicle-overview-tab';
import { VehicleDocumentsTab } from './vehicle-documents-tab';
import { VehicleMaintenanceTab } from './vehicle-maintenance-tab';
import { VehicleFuelTab } from './vehicle-fuel-tab';

interface VehicleDetailProps {
  vanId: string;
}

export function VehicleDetail({ vanId }: VehicleDetailProps) {
  const { data: vehicle, isLoading } = useVehicle(vanId);
  const { data: costSummary } = useVehicleCostSummary(vanId);

  if (isLoading || !vehicle) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading vehicle…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Truck className="h-6 w-6 text-primary" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black">{vehicle.plateNumber}</h1>
            {!vehicle.isActive && <Badge variant="outline">Inactive</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {vehicle.defaultDriver ? `Driver: ${vehicle.defaultDriver.name}` : 'No driver assigned'}
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="rounded-xl">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="fuel">Fuel</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <VehicleOverviewTab vehicle={vehicle} costSummary={costSummary} />
        </TabsContent>
        <TabsContent value="documents" className="mt-4">
          <VehicleDocumentsTab vanId={vanId} documents={vehicle.vehicleDocuments} />
        </TabsContent>
        <TabsContent value="maintenance" className="mt-4">
          <VehicleMaintenanceTab vanId={vanId} currentOdometer={vehicle.vehicleProfile?.currentOdometer ?? 0} />
        </TabsContent>
        <TabsContent value="fuel" className="mt-4">
          <VehicleFuelTab vanId={vanId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
