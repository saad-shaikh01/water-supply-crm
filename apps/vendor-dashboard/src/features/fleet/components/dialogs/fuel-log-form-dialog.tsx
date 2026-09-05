'use client';

import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Fuel } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button, Input, Label,
} from '@water-supply-crm/ui';
import type { FuelLogEntry } from '@water-supply-crm/types';
import { fuelLogSchema, type FuelLogInput } from '../../schemas';
import { useCreateFuelLog, useUpdateFuelLog } from '../../hooks/use-fuel-logs';
import { useVehicleDailyChecks } from '../../hooks/use-vehicle-checks';
import { FleetPhotoUpload } from '../fleet-photo-upload';

interface FuelLogFormDialogProps {
  // Direct mode — used by Fleet's own Vehicle Detail page, which already
  // knows exactly which vehicle it's on.
  vehicleId?: string;
  // Sheet mode — used from the Daily Sheet (sheet-detail.tsx), which only
  // knows the route (van), not which physical vehicle is running it today.
  // The §17 Amendment (2026-08-21) records that link on the sheet's own
  // START Vehicle Check, so when `vehicleId` isn't passed directly, it's
  // resolved from that check instead of asking the driver to re-identify
  // the vehicle. `vanId` is accepted only for backward-compat with the
  // existing daily-sheet call site — it is no longer used (kept optional
  // and unread rather than removed, to avoid an excess-prop TS error on a
  // caller in features/daily-sheets/**, out of scope for this change — see
  // docs/features/fleet-operations-vehicle-intelligence.md §17).
  vanId?: string;
  dailySheetId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Edit mode — passed by the Expense Center detail drawer (Phase 2b) with
  // the full record fetched via `useFuelLog(sourceRecordId)`. When present,
  // every field prefills from it, the title/submit label switch to "Edit"/
  // "Save changes", and submit calls `useUpdateFuelLog` instead of create.
  // Absent (create mode, the original behaviour) this is fully unchanged.
  fuelLog?: FuelLogEntry;
}

/** Same visual toggle used across Fleet forms — matches collection-policy's Toggle exactly for consistency. */
function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${enabled ? 'bg-emerald-500' : 'bg-input dark:bg-muted'}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

export function FuelLogFormDialog({ vehicleId, dailySheetId, open, onOpenChange, fuelLog }: FuelLogFormDialogProps) {
  const isEdit = !!fuelLog;
  const [receiptPhotoKey, setReceiptPhotoKey] = useState<string | undefined>(undefined);
  const { mutate: createFuelLog, isPending: isCreating } = useCreateFuelLog();
  const { mutate: updateFuelLog, isPending: isUpdating } = useUpdateFuelLog();
  const isPending = isCreating || isUpdating;
  const { data: checks } = useVehicleDailyChecks(vehicleId || isEdit ? undefined : dailySheetId);
  const resolvedVehicleId = fuelLog?.vehicleId ?? vehicleId ?? checks?.find((c) => c.checkType === 'START')?.vehicleId ?? undefined;

  const { register, handleSubmit, reset, control, watch, formState: { errors } } = useForm<FuelLogInput>({
    resolver: zodResolver(fuelLogSchema),
    defaultValues: {
      date: new Date().toISOString().slice(0, 10),
      odometerAtFill: 0,
      litersFilled: 0,
      amountPaid: 0,
      isFullTank: true,
      // Fuel fills are mostly paid by card in practice, not out of today's
      // collections — default to OFF so the common case needs no tap, and
      // the driver only turns it on for the actual cash-paid fills.
      paidFromCash: false,
      fuelStation: '',
      notes: '',
    },
  });
  const isFullTank = watch('isFullTank');
  const paidFromCash = watch('paidFromCash');

  useEffect(() => {
    if (open && fuelLog) {
      reset({
        date: fuelLog.date.slice(0, 10),
        odometerAtFill: fuelLog.odometerAtFill,
        litersFilled: fuelLog.litersFilled,
        amountPaid: fuelLog.amountPaid,
        isFullTank: fuelLog.isFullTank,
        paidFromCash: fuelLog.paidFromCash,
        fuelStation: fuelLog.fuelStation ?? '',
        notes: fuelLog.notes ?? '',
      });
      setReceiptPhotoKey(fuelLog.receiptPhotoKey ?? undefined);
    } else if (open && !fuelLog) {
      reset({
        date: new Date().toISOString().slice(0, 10),
        odometerAtFill: 0,
        litersFilled: 0,
        amountPaid: 0,
        isFullTank: true,
        paidFromCash: false,
        fuelStation: '',
        notes: '',
      });
      setReceiptPhotoKey(undefined);
    }
  }, [open, fuelLog, reset]);

  function onSubmit(values: FuelLogInput) {
    if (isEdit) {
      updateFuelLog(
        { id: fuelLog!.id, data: { ...values, receiptPhotoKey } },
        { onSuccess: () => onOpenChange(false) },
      );
      return;
    }
    if (!resolvedVehicleId) return;
    createFuelLog(
      { vehicleId: resolvedVehicleId, dailySheetId, ...values, receiptPhotoKey },
      {
        onSuccess: () => {
          onOpenChange(false);
          reset();
          setReceiptPhotoKey(undefined);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Fuel className="h-5 w-5 text-primary" />
            {isEdit ? 'Edit Fuel Fill' : 'Log Fuel Fill'}
          </DialogTitle>
        </DialogHeader>

        {!resolvedVehicleId && dailySheetId ? (
          <p className="text-sm text-muted-foreground">
            Record a Start-of-Day Vehicle Check first — the fuel log needs to know which vehicle is running today&apos;s trip.
          </p>
        ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Odometer (km)</Label>
              <Input type="number" className="rounded-xl" {...register('odometerAtFill', { valueAsNumber: true })} />
              {errors.odometerAtFill && <p className="text-xs text-destructive">{errors.odometerAtFill.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" className="rounded-xl" {...register('date')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Liters</Label>
              <Input type="number" step="0.1" className="rounded-xl" {...register('litersFilled', { valueAsNumber: true })} />
              {errors.litersFilled && <p className="text-xs text-destructive">{errors.litersFilled.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Amount Paid (₨)</Label>
              <Input type="number" className="rounded-xl" {...register('amountPaid', { valueAsNumber: true })} />
              {errors.amountPaid && <p className="text-xs text-destructive">{errors.amountPaid.message}</p>}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Filled to full tank?</p>
              <p className="text-xs text-muted-foreground">Only full-tank fills count toward fuel efficiency tracking.</p>
            </div>
            <Controller
              name="isFullTank"
              control={control}
              render={({ field }) => <Toggle enabled={field.value} onToggle={() => field.onChange(!field.value)} label="Full tank" />}
            />
          </div>

          {/*
           * Most fills are paid straight out of the driver's collected cash,
           * so the deduction from cash hand-in happens by default. When fuel
           * is instead paid by card/bank/company account, that cash was
           * never taken out of the driver's pocket — turning this off keeps
           * the full collected amount in the hand-in total instead of
           * silently short-changing it (Cash Out → Reconcile screens both
           * read this same flag).
           */}
          <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${paidFromCash ? 'border-border/50' : 'border-blue-500/40 bg-blue-500/5'}`}>
            <div>
              <p className="text-sm font-semibold">Paid from van cash?</p>
              <p className="text-xs text-muted-foreground">
                {paidFromCash
                  ? 'This amount will be deducted from the cash hand-in.'
                  : 'Off = paid by card / bank / company account — won\'t be deducted from cash hand-in.'}
              </p>
            </div>
            <Controller
              name="paidFromCash"
              control={control}
              render={({ field }) => <Toggle enabled={field.value} onToggle={() => field.onChange(!field.value)} label="Paid from van cash" />}
            />
          </div>

          <div className="space-y-2">
            <Label>Fuel Station (optional)</Label>
            <Input className="rounded-xl" {...register('fuelStation')} />
          </div>

          <FleetPhotoUpload label="Receipt" maxPhotos={1} onPhotosChange={(keys) => setReceiptPhotoKey(keys[0])} />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="rounded-xl font-bold">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isEdit ? 'Save changes' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
