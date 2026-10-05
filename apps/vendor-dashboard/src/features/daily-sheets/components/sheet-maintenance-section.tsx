'use client';

import { useState } from 'react';
import { Pencil, Trash2, Wrench } from 'lucide-react';
import { Card, CardContent } from '@water-supply-crm/ui';
import { VEHICLE_SERVICE_TYPE_LABELS, type VehicleServiceRecordEntry } from '@water-supply-crm/types';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { ServiceRecordFormDialog } from '../../fleet/components/dialogs/service-record-form-dialog';
import { useDeleteServiceRecord, useServiceRecords, useServiceTypes } from '../../fleet/hooks/use-maintenance';

interface SheetMaintenanceSectionProps {
  vehicleId: string;
  /** Sheet date (ISO) — service records aren't linked to a sheet, so the
   *  section lists this vehicle's records performed on that day. */
  date: string;
  /** fleet:manage_maintenance — edit/delete stay live on closed sheets too:
   *  a service record is a fleet record, not van cash, so there's no
   *  reconciliation to protect. */
  canManage: boolean;
}

export function SheetMaintenanceSection({ vehicleId, date, canManage }: SheetMaintenanceSectionProps) {
  const day = date.slice(0, 10);
  const { data } = useServiceRecords({ vehicleId, dateFrom: day, dateTo: day, limit: 50 });
  const { data: serviceTypes } = useServiceTypes();
  const [editRecord, setEditRecord] = useState<VehicleServiceRecordEntry | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { mutate: deleteRecord, isPending: isDeleting } = useDeleteServiceRecord();

  const records = data?.data ?? [];
  if (records.length === 0) return null;

  const labelFor = (key: string) =>
    serviceTypes?.find((t) => t.key === key)?.label ??
    (VEHICLE_SERVICE_TYPE_LABELS as Record<string, string>)[key] ??
    key;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Vehicle Maintenance</h3>
      <div className="space-y-2">
        {records.map((r) => (
          <Card key={r.id} className="bg-card/50 border-border/40">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-destructive/10 text-destructive">
                <Wrench className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{labelFor(r.serviceType)}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {r.performedAtOdometer.toLocaleString()} km
                  {r.workshopName && ` · ${r.workshopName}`}
                  {r.notes && ` · ${r.notes}`}
                </p>
              </div>
              <span className="text-sm font-bold shrink-0">₨ {Number(r.cost).toLocaleString()}</span>
              {canManage && (
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label="Edit maintenance record"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                    onClick={() => setEditRecord(r)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete maintenance record"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteId(r.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {editRecord && (
        <ServiceRecordFormDialog
          vehicleId={editRecord.vehicleId}
          serviceRecord={editRecord}
          open
          onOpenChange={(o) => { if (!o) setEditRecord(null); }}
        />
      )}

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="Delete Maintenance Record"
        description="Are you sure? This also removes its expense. This action cannot be undone."
        onConfirm={() => {
          if (deleteId) deleteRecord(deleteId, { onSuccess: () => setDeleteId(null) });
        }}
        isLoading={isDeleting}
        confirmLabel="Delete"
      />
    </div>
  );
}
