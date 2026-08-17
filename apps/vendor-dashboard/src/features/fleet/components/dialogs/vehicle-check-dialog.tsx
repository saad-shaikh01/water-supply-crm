'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button, Input, Label } from '@water-supply-crm/ui';
import { Loader2, Gauge, CheckCircle2, XCircle } from 'lucide-react';
import { VEHICLE_CHECKLIST_ITEMS } from '@water-supply-crm/types';
import type { VehicleCheckType } from '@water-supply-crm/types';
import { useCreateVehicleDailyCheck } from '../../hooks/use-vehicle-checks';
import { FleetPhotoUpload } from '../fleet-photo-upload';

interface VehicleCheckDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  checkType: VehicleCheckType;
}

/**
 * The morning/evening pre-trip record (plan doc §7.2/§7.11). Default-OK grid —
 * the driver only taps what's wrong, per the plan's UX principle that this
 * whole flow must be completable in well under a minute.
 */
export function VehicleCheckDialog({ open, onClose, sheetId, checkType }: VehicleCheckDialogProps) {
  const { mutate: createCheck, isPending } = useCreateVehicleDailyCheck();
  const [odometerReading, setOdometerReading] = useState('');
  const [odometerPhotoKey, setOdometerPhotoKey] = useState<string | undefined>(undefined);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [damageNoted, setDamageNoted] = useState(false);
  const [damageNote, setDamageNote] = useState('');
  const [damagePhotoKeys, setDamagePhotoKeys] = useState<string[]>([]);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setOdometerReading('');
      setOdometerPhotoKey(undefined);
      setResults(Object.fromEntries(VEHICLE_CHECKLIST_ITEMS.map((i) => [i.key, true])));
      setDamageNoted(false);
      setDamageNote('');
      setDamagePhotoKeys([]);
      setNote('');
    }
  }, [open, checkType]);

  const criticalFailing = VEHICLE_CHECKLIST_ITEMS.filter((i) => i.isCritical && results[i.key] === false);

  function handleSubmit() {
    const odometer = Number(odometerReading);
    if (!odometerReading || Number.isNaN(odometer)) return;

    createCheck(
      {
        dailySheetId: sheetId,
        checkType,
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
          <Button onClick={handleSubmit} disabled={isPending || !odometerReading} className="rounded-xl font-bold">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Submit Check
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
