'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Fuel } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button, Input, Label,
} from '@water-supply-crm/ui';
import { fuelLogSchema, type FuelLogInput } from '../../schemas';
import { useCreateFuelLog } from '../../hooks/use-fuel-logs';
import { FleetPhotoUpload } from '../fleet-photo-upload';

interface FuelLogFormDialogProps {
  vanId: string;
  dailySheetId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function FuelLogFormDialog({ vanId, dailySheetId, open, onOpenChange }: FuelLogFormDialogProps) {
  const [receiptPhotoKey, setReceiptPhotoKey] = useState<string | undefined>(undefined);
  const { mutate: createFuelLog, isPending } = useCreateFuelLog();

  const { register, handleSubmit, reset, control, watch, formState: { errors } } = useForm<FuelLogInput>({
    resolver: zodResolver(fuelLogSchema),
    defaultValues: {
      date: new Date().toISOString().slice(0, 10),
      odometerAtFill: 0,
      litersFilled: 0,
      amountPaid: 0,
      isFullTank: true,
      fuelStation: '',
      notes: '',
    },
  });
  const isFullTank = watch('isFullTank');

  function onSubmit(values: FuelLogInput) {
    createFuelLog(
      { vanId, dailySheetId, ...values, receiptPhotoKey },
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
            Log Fuel Fill
          </DialogTitle>
        </DialogHeader>

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
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
