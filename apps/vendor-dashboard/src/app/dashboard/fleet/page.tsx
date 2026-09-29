'use client';

import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { FleetOverviewCards } from '../../../features/fleet/components/fleet-overview-cards';
import { VehicleList } from '../../../features/fleet/components/vehicle-list';
import { AlertRecipientsDialog } from '../../../features/fleet/components/dialogs/alert-recipients-dialog';
import { useCan } from '../../../features/authz/hooks/use-can';

export default function FleetPage() {
  const canManageAlerts = useCan('fleet:manage_alerts');
  const [alertsOpen, setAlertsOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet"
        description="Vehicle health, maintenance, fuel, and cost — per vehicle and fleet-wide."
        action={
          canManageAlerts ? (
            <Button variant="outline" className="rounded-xl gap-2" onClick={() => setAlertsOpen(true)}>
              <Bell className="h-4 w-4" />
              WhatsApp Alerts
            </Button>
          ) : undefined
        }
      />
      <FleetOverviewCards />
      <VehicleList />
      {canManageAlerts && <AlertRecipientsDialog open={alertsOpen} onOpenChange={setAlertsOpen} />}
    </div>
  );
}
