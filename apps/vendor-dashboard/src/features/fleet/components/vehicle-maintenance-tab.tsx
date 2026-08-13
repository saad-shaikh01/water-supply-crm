'use client';

import { useState } from 'react';
import { Plus, Wrench, AlertTriangle, Clock } from 'lucide-react';
import { Card, CardContent, Button, Badge, Skeleton } from '@water-supply-crm/ui';
import { useVehicleMaintenanceStatus } from '../hooks/use-maintenance';
import { ServiceRecordFormDialog } from './dialogs/service-record-form-dialog';

const URGENCY_STYLE: Record<string, { label: string; className: string }> = {
  OVERDUE: { label: 'Overdue', className: 'bg-destructive/10 text-destructive border-destructive/30' },
  DUE: { label: 'Due Soon', className: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
  UPCOMING: { label: 'Upcoming', className: 'bg-blue-500/10 text-blue-500 border-blue-500/30' },
  OK: { label: 'OK', className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' },
};

interface VehicleMaintenanceTabProps {
  vanId: string;
  currentOdometer: number;
}

export function VehicleMaintenanceTab({ vanId, currentOdometer }: VehicleMaintenanceTabProps) {
  const { data: statuses, isLoading } = useVehicleMaintenanceStatus(vanId);
  const [recordFormOpen, setRecordFormOpen] = useState(false);
  const [defaultServiceType, setDefaultServiceType] = useState<string | undefined>(undefined);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
      </div>
    );
  }

  const sorted = [...(statuses ?? [])].sort((a, b) => {
    const order = { OVERDUE: 0, DUE: 1, UPCOMING: 2, OK: 3 };
    return (order[a.urgency as keyof typeof order] ?? 4) - (order[b.urgency as keyof typeof order] ?? 4);
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => { setDefaultServiceType(undefined); setRecordFormOpen(true); }}
          className="rounded-xl font-bold gap-2"
        >
          <Plus className="h-4 w-4" />
          Record Service
        </Button>
      </div>

      <div className="space-y-2">
        {sorted.map((status) => {
          const style = URGENCY_STYLE[status.urgency] ?? URGENCY_STYLE.OK;
          return (
            <Card key={status.serviceType} className="rounded-2xl">
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {status.urgency === 'OVERDUE' ? (
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                  ) : status.urgency === 'DUE' ? (
                    <Clock className="h-5 w-5 text-amber-500 shrink-0" />
                  ) : (
                    <Wrench className="h-5 w-5 text-muted-foreground shrink-0" />
                  )}
                  <div>
                    <p className="font-semibold text-sm">{status.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {status.lastServiceOdometer != null
                        ? `Last: ${status.lastServiceOdometer.toLocaleString()} km`
                        : 'Never serviced'}
                      {status.intervalKm ? ` · every ${status.intervalKm.toLocaleString()} km` : ''}
                      {status.intervalDays ? ` · every ${status.intervalDays}d` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={style.className}>{style.label}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-lg text-xs"
                    onClick={() => { setDefaultServiceType(status.serviceType); setRecordFormOpen(true); }}
                  >
                    Log
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ServiceRecordFormDialog
        vanId={vanId}
        open={recordFormOpen}
        onOpenChange={setRecordFormOpen}
        defaultServiceType={defaultServiceType}
        currentOdometer={currentOdometer}
      />
    </div>
  );
}
