'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button, Input, Label } from '@water-supply-crm/ui';
import { Loader2, Gauge, CheckCircle2, XCircle, Truck, Search } from 'lucide-react';
import { VEHICLE_CHECKLIST_ITEMS } from '@water-supply-crm/types';
import type { VehicleCheckType } from '@water-supply-crm/types';
import { useCreateVehicleDailyCheck, useVehicleDailyChecks } from '../../hooks/use-vehicle-checks';
import { useActiveVehiclesForPicker } from '../../hooks/use-fleet';
import { FleetPhotoUpload } from '../fleet-photo-upload';

interface VehicleCheckDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  checkType: VehicleCheckType;
  // Optional route context (the sheet's own vanId) — used only to pre-sort
  // the START picker by usualVanId match (§17.3/§17.5). Not required: the
  // dialog can look this up itself via sheetId if the caller doesn't have it
  // handy, but sheet-detail.tsx already does, so it's threaded through.
  vanId?: string;
}

/**
 * The morning/evening pre-trip record (plan doc §7.2/§7.11). Default-OK grid —
 * the driver only taps what's wrong, per the plan's UX principle that this
 * whole flow must be completable in well under a minute.
 *
 * §17 Amendment (2026-08-21): the START check now also requires picking the
 * physical vehicle taking this route out today (searchable list, pre-sorted
 * by usualVanId match — §17.3). The END check does NOT re-ask — it just
 * displays which vehicle this trip used, read-only, inherited server-side
 * from the sheet's own START check (one trip, one vehicle — §17.5, locked).
 */
export function VehicleCheckDialog({ open, onClose, sheetId, checkType, vanId }: VehicleCheckDialogProps) {
  const { mutate: createCheck, isPending } = useCreateVehicleDailyCheck();
  const { data: existingChecks } = useVehicleDailyChecks(sheetId);
  const { data: vehiclesPage, isLoading: vehiclesLoading } = useActiveVehiclesForPicker();

  const [odometerReading, setOdometerReading] = useState('');
  const [odometerPhotoKey, setOdometerPhotoKey] = useState<string | undefined>(undefined);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [damageNoted, setDamageNoted] = useState(false);
  const [damageNote, setDamageNote] = useState('');
  const [damagePhotoKeys, setDamagePhotoKeys] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [vehicleId, setVehicleId] = useState<string | undefined>(undefined);
  const [vehicleSearch, setVehicleSearch] = useState('');

  const startCheck = existingChecks?.find((c) => c.checkType === 'START');
  const inheritedVehiclePlate = checkType === 'END'
    ? vehiclesPage?.data.find((v) => v.id === startCheck?.vehicleId)?.plateNumber
    : undefined;

  const sortedVehicles = useMemo(() => {
    const vehicles = vehiclesPage?.data ?? [];
    const filtered = vehicleSearch
      ? vehicles.filter((v) => v.plateNumber.toLowerCase().includes(vehicleSearch.toLowerCase()))
      : vehicles;
    return [...filtered].sort((a, b) => {
      const aUsual = vanId && a.usualVanId === vanId ? 0 : 1;
      const bUsual = vanId && b.usualVanId === vanId ? 0 : 1;
      return aUsual - bUsual || a.plateNumber.localeCompare(b.plateNumber);
    });
  }, [vehiclesPage, vehicleSearch, vanId]);

  useEffect(() => {
    if (open) {
      setOdometerReading('');
      setOdometerPhotoKey(undefined);
      setResults(Object.fromEntries(VEHICLE_CHECKLIST_ITEMS.map((i) => [i.key, true])));
      setDamageNoted(false);
      setDamageNote('');
      setDamagePhotoKeys([]);
      setNote('');
      setVehicleSearch('');
      setVehicleId(undefined);
    }
  }, [open, checkType]);

  // Pre-select the usual vehicle for this route once the pool loads.
  useEffect(() => {
    if (open && checkType === 'START' && !vehicleId && sortedVehicles.length > 0 && vanId) {
      const usual = sortedVehicles.find((v) => v.usualVanId === vanId);
      if (usual) setVehicleId(usual.id);
    }
  }, [open, checkType, vehicleId, sortedVehicles, vanId]);

  const criticalFailing = VEHICLE_CHECKLIST_ITEMS.filter((i) => i.isCritical && results[i.key] === false);

  function handleSubmit() {
    const odometer = Number(odometerReading);
    if (!odometerReading || Number.isNaN(odometer)) return;
    if (checkType === 'START' && !vehicleId) return;

    createCheck(
      {
        dailySheetId: sheetId,
        checkType,
        vehicleId: checkType === 'START' ? vehicleId : undefined,
        odometerReading: odometer,
        odometerPhotoKey,
        checklistResults: VEHICLE_CHECKLIST_ITEMS.map((item) => ({
          key: item.key,
          passed: results[item.key] ?? true,
        })),
        damageNoted,
        damageNote: damageNoted ? damageNote || undefined : undefined,
        damagePhotoKeys: damageNoted ? damagePhotoKeys : undefined,
        note: note || undefined,
      },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            {checkType === 'START' ? 'Start-of-Day Vehicle Check' : 'End-of-Day Vehicle Check'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {checkType === 'START' ? (
            <div className="space-y-2">
              <Label>Which vehicle is taking this route out today?</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="rounded-xl pl-9"
                  placeholder="Search by plate number…"
                  value={vehicleSearch}
                  onChange={(e) => setVehicleSearch(e.target.value)}
                />
              </div>
              <div className="max-h-40 overflow-y-auto rounded-xl border border-border/50 divide-y divide-border/50">
                {vehiclesLoading ? (
                  <div className="p-3 text-sm text-muted-foreground">Loading vehicles…</div>
                ) : sortedVehicles.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No active vehicles found.</div>
                ) : (
                  sortedVehicles.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVehicleId(v.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                        vehicleId === v.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'
                      }`}
                    >
                      <Truck className="h-4 w-4 shrink-0" />
                      {v.plateNumber}
                      {v.usualVanId === vanId && <span className="text-[11px] font-normal text-muted-foreground">usually this route</span>}
                    </button>
                  ))
                )}
              </div>
              {!vehicleId && (
                <p className="text-xs text-muted-foreground">Select the vehicle before submitting.</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-border/50 px-4 py-3">
              <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">Vehicle on this trip</p>
                <p className="text-sm font-bold">{inheritedVehiclePlate ?? 'Not recorded on the start check'}</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Odometer (km)</Label>
            <Input
              type="number"
              inputMode="numeric"
              className="rounded-xl text-lg font-bold h-12"
              value={odometerReading}
              onChange={(e) => setOdometerReading(e.target.value)}
              placeholder="e.g. 45210"
              autoFocus
            />
          </div>

          <FleetPhotoUpload label="Odometer Photo" maxPhotos={1} onPhotosChange={(keys) => setOdometerPhotoKey(keys[0])} />

          <div className="space-y-2">
            <Label>Vehicle Checklist — tap anything that&apos;s NOT OK</Label>
            <div className="grid grid-cols-2 gap-2">
              {VEHICLE_CHECKLIST_ITEMS.map((item) => {
                const passed = results[item.key] ?? true;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setResults((prev) => ({ ...prev, [item.key]: !(prev[item.key] ?? true) }))}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition-colors ${
                      passed
                        ? 'border-border bg-background'
                        : item.isCritical
                          ? 'border-destructive bg-destructive/10 text-destructive'
                          : 'border-amber-500 bg-amber-500/10 text-amber-600'
                    }`}
                  >
                    {passed ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0" />
                    )}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
            {criticalFailing.length > 0 && (
              <p className="text-xs font-semibold text-destructive">
                ⚠ {criticalFailing.map((i) => i.label).join(', ')} — Staff/Admin must acknowledge this before the trip can start.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border/50 p-3 space-y-3">
            <button
              type="button"
              onClick={() => setDamageNoted((v) => !v)}
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <span
                className={`h-5 w-5 rounded-md border flex items-center justify-center transition-colors ${
                  damageNoted ? 'bg-destructive border-destructive text-white' : 'border-border'
                }`}
              >
                {damageNoted && <XCircle className="h-3.5 w-3.5" />}
              </span>
              Report new damage / issue today?
            </button>
            {damageNoted && (
              <div className="space-y-3">
                <Input
                  value={damageNote}
                  onChange={(e) => setDamageNote(e.target.value)}
                  placeholder="What happened?"
                  className="rounded-xl"
                />
                <FleetPhotoUpload label="Damage Photos" maxPhotos={3} onPhotosChange={setDamagePhotoKeys} />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="rounded-xl" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !odometerReading || (checkType === 'START' && !vehicleId)}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Submit Check
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
