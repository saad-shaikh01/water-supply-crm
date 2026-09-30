'use client';

import { useState } from 'react';
import { Plus, Wrench, AlertTriangle, Clock, Pencil, Check, X, Loader2 } from 'lucide-react';
import { Card, CardContent, Button, Badge, Skeleton, Input, Label } from '@water-supply-crm/ui';
import type { VehicleMaintenanceStatusEntry } from '@water-supply-crm/types';
import { useVehicleMaintenanceStatus, useUpdateMaintenanceRule } from '../hooks/use-maintenance';
import { ServiceRecordFormDialog } from './dialogs/service-record-form-dialog';
import { VehicleServiceHistory } from './vehicle-service-history';
import type { FleetPeriod } from './fleet-period-picker';

const toPositiveIntOrNull = (raw: string): number | null => {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const URGENCY_STYLE: Record<string, { label: string; className: string }> = {
  OVERDUE: { label: 'Overdue', className: 'bg-destructive/10 text-destructive border-destructive/30' },
  DUE: { label: 'Due Soon', className: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
  UPCOMING: { label: 'Upcoming', className: 'bg-blue-500/10 text-blue-500 border-blue-500/30' },
  OK: { label: 'OK', className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' },
};

interface VehicleMaintenanceTabProps {
  vehicleId: string;
  currentOdometer: number;
  period: FleetPeriod;
}

export function VehicleMaintenanceTab({ vehicleId, currentOdometer, period }: VehicleMaintenanceTabProps) {
  const { data: statuses, isLoading } = useVehicleMaintenanceStatus(vehicleId);
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
        {sorted.map((status) => (
          <MaintenanceRuleCard key={status.serviceType} status={status} vehicleId={vehicleId} onLog={() => {
            setDefaultServiceType(status.serviceType);
            setRecordFormOpen(true);
          }} />
        ))}
      </div>

      <VehicleServiceHistory vehicleId={vehicleId} period={period} />

      <ServiceRecordFormDialog
        vehicleId={vehicleId}
        open={recordFormOpen}
        onOpenChange={setRecordFormOpen}
        defaultServiceType={defaultServiceType}
        currentOdometer={currentOdometer}
      />
    </div>
  );
}

interface MaintenanceRuleCardProps {
  status: VehicleMaintenanceStatusEntry;
  vehicleId: string;
  onLog: () => void;
}

/** One category row — view mode, or inline edit of its per-vehicle km/days interval. */
function MaintenanceRuleCard({ status, vehicleId, onLog }: MaintenanceRuleCardProps) {
  const { mutate: updateRule, isPending } = useUpdateMaintenanceRule();
  const [editing, setEditing] = useState(false);
  const [editKm, setEditKm] = useState('');
  const [editDays, setEditDays] = useState('');

  const style = URGENCY_STYLE[status.urgency] ?? URGENCY_STYLE.OK;

  function startEdit() {
    setEditKm(status.intervalKm ? String(status.intervalKm) : '');
    setEditDays(status.intervalDays ? String(status.intervalDays) : '');
    setEditing(true);
  }

  function saveEdit() {
    const nextKm = toPositiveIntOrNull(editKm);
    const nextDays = toPositiveIntOrNull(editDays);
    if (nextKm === status.intervalKm && nextDays === status.intervalDays) {
      setEditing(false);
      return;
    }
    updateRule(
      { id: status.ruleId, vehicleId, data: { intervalKm: nextKm, intervalDays: nextDays } },
      { onSuccess: () => setEditing(false) },
    );
  }

  if (editing) {
    return (
      <Card className="rounded-2xl border-primary/40">
        <CardContent className="p-4 space-y-3">
          <p className="font-semibold text-sm">{status.label}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor={`rule-km-${status.ruleId}`} className="text-xs text-muted-foreground">
                Every (km) — optional
              </Label>
              <Input
                id={`rule-km-${status.ruleId}`}
                type="number"
                min={1}
                autoFocus
                className="h-8 rounded-lg"
                value={editKm}
                onChange={(e) => setEditKm(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`rule-days-${status.ruleId}`} className="text-xs text-muted-foreground">
                Every (days) — optional
              </Label>
              <Input
                id={`rule-days-${status.ruleId}`}
                type="number"
                min={1}
                className="h-8 rounded-lg"
                value={editDays}
                onChange={(e) => setEditDays(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-lg gap-1"
              disabled={isPending}
              onClick={() => setEditing(false)}
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button type="button" size="sm" className="rounded-lg gap-1" disabled={isPending} onClick={saveEdit}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl">
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
            size="icon"
            className="h-8 w-8 rounded-lg"
            title={`Edit ${status.label} interval`}
            aria-label={`Edit ${status.label} interval`}
            onClick={startEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="rounded-lg text-xs" onClick={onLog}>
            Log
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
