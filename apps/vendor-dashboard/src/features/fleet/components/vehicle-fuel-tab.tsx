'use client';

import { useState } from 'react';
import { Plus, Fuel, CreditCard } from 'lucide-react';
import { Card, CardContent, Button, Badge, Skeleton } from '@water-supply-crm/ui';
import { useFuelLogs } from '../hooks/use-fuel-logs';
import { FuelLogFormDialog } from './dialogs/fuel-log-form-dialog';
import { useCan } from '../../authz/hooks/use-can';

interface VehicleFuelTabProps {
  vanId: string;
}

export function VehicleFuelTab({ vanId }: VehicleFuelTabProps) {
  const canRecord = useCan('fleet:record_fuel');
  const [formOpen, setFormOpen] = useState(false);
  const { data, isLoading } = useFuelLogs({ vanId, limit: 20 });

  return (
    <div className="space-y-4">
      {canRecord && (
        <div className="flex justify-end">
          <Button onClick={() => setFormOpen(true)} className="rounded-xl font-bold gap-2">
            <Plus className="h-4 w-4" />
            Log Fuel Fill
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
        </div>
      ) : !data?.data.length ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            No fuel fills logged yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.data.map((log) => (
            <Card key={log.id} className="rounded-2xl">
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Fuel className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="font-semibold text-sm">
                      {log.litersFilled}L — ₨{log.amountPaid.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(log.date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' · '}
                      {log.odometerAtFill.toLocaleString()} km
                      {log.fuelStation ? ` · ${log.fuelStation}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {log.paidFromCash === false && (
                    <Badge className="text-[11px] border-none bg-blue-500/10 text-blue-600 gap-1">
                      <CreditCard className="h-3 w-3" />
                      Card
                    </Badge>
                  )}
                  {!log.isFullTank && (
                    <Badge variant="outline" className="text-[11px]">Partial fill</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <FuelLogFormDialog vanId={vanId} open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
