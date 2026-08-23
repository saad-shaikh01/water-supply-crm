'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button, Input, Label, Textarea } from '@water-supply-crm/ui';
import { Loader2, Gauge } from 'lucide-react';
import type { VehicleDailyCheckEntry } from '@water-supply-crm/types';
import { useUpdateVehicleDailyCheck } from '../../hooks/use-vehicle-checks';

interface VehicleCheckEditDialogProps {
  open: boolean;
  onClose: () => void;
  dailySheetId: string;
  check: VehicleDailyCheckEntry | null;
}

/**
 * Odometer Correction (2026-08-23, owner request): Staff/Admin fixes a
 * mis-entered odometer reading on an already-submitted START/END check —
 * previously permanently locked once recorded. The backend re-validates the
 * new value against this vehicle's neighbouring checks (can't go backwards
 * — vehicle-check.service.ts#update), so a bad value here comes back as a
 * clear 400, not a silently wrong correction. `reason` is mandatory, same
 * bar as CriticalOverrideDialog's own note.
 */
export function VehicleCheckEditDialog({ open, onClose, dailySheetId, check }: VehicleCheckEditDialogProps) {
  const { mutate: updateCheck, isPending } = useUpdateVehicleDailyCheck();
  const [odometerReading, setOdometerReading] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open && check) {
      setOdometerReading(String(check.odometerReading));
      setReason('');
    }
  }, [open, check]);

  function handleSubmit() {
    if (!check) return;
    const odometer = Number(odometerReading);
    if (!odometerReading || Number.isNaN(odometer) || !reason.trim()) return;

    updateCheck(
      { id: check.id, dailySheetId, odometerReading: odometer, reason },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            Correct {check?.checkType === 'START' ? 'Start' : 'End'}-of-Day Odometer
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {check?.originalOdometerReading != null && (
            <p className="text-xs text-muted-foreground">
              Originally submitted as{' '}
              <span className="font-semibold text-foreground">{check.originalOdometerReading.toLocaleString()} km</span>.
              This will be edit #{check.odometerEditedAt ? '2+' : '1'}.
            </p>
          )}

          <div className="space-y-2">
            <Label>Correct Odometer Reading (km)</Label>
            <Input
              type="number"
              inputMode="numeric"
              className="rounded-xl text-lg font-bold h-12"
              value={odometerReading}
              onChange={(e) => setOdometerReading(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Reason for Correction</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Driver misread the odometer, correcting from photo."
              className="rounded-xl min-h-20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !odometerReading || !reason.trim()}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
