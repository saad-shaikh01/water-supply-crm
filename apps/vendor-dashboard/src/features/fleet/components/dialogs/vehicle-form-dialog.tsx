'use client';

import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Truck } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { vehicleBasicSchema, type VehicleBasicInput } from '../../schemas';
import { useCreateVehicle, useUpdateVehicleBasic } from '../../hooks/use-fleet';
import { useAllVans } from '../../../vans/hooks/use-vans';

// No usual-route sentinel — see comment on vehicleBasicSchema.
const NO_VAN = '__none__';

interface VehicleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Pass a vehicle to edit its plate/usual route; omit to create a new one.
  vehicle?: { id: string; plateNumber: string; usualVanId: string | null } | null;
}

/**
 * Create/edit the Vehicle's own identity: its real number plate and (optionally)
 * which route it usually serves. Deliberately does NOT touch Van at all — Van's
 * own `plateNumber` field (the "Van1"/"Van2" route label used everywhere else in
 * the app — daily sheets, customer schedules, etc.) is a separate column on a
 * separate model and is untouched by anything in this dialog.
 */
export function VehicleFormDialog({ open, onOpenChange, vehicle }: VehicleFormDialogProps) {
  const isEdit = !!vehicle;
  const { data: vansPage } = useAllVans();
  const { mutate: createVehicle, isPending: creating } = useCreateVehicle();
  const { mutate: updateVehicle, isPending: updating } = useUpdateVehicleBasic();
  const isPending = creating || updating;

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<VehicleBasicInput>({
    resolver: zodResolver(vehicleBasicSchema),
    defaultValues: { plateNumber: '', usualVanId: NO_VAN },
  });

  useEffect(() => {
    if (open) {
      reset({
        plateNumber: vehicle?.plateNumber ?? '',
        usualVanId: vehicle?.usualVanId ?? NO_VAN,
      });
    }
  }, [open, vehicle, reset]);

  function onSubmit(values: VehicleBasicInput) {
    const usualVanId = values.usualVanId === NO_VAN ? null : values.usualVanId;
    if (isEdit) {
      updateVehicle(
        { vehicleId: vehicle.id, data: { plateNumber: values.plateNumber, usualVanId } },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      createVehicle(
        { plateNumber: values.plateNumber, usualVanId: usualVanId ?? undefined },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            {isEdit ? 'Edit Vehicle' : 'Add Vehicle'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Number Plate</Label>
            <Input className="rounded-xl" placeholder="e.g. KHI-1234" {...register('plateNumber')} />
            {errors.plateNumber && <p className="text-xs text-destructive">{errors.plateNumber.message}</p>}
            <p className="text-xs text-muted-foreground">
              The vehicle&apos;s real registration plate — separate from the route name (Van1, Van2…) below.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Usually Serves Route (optional)</Label>
            <Controller
              name="usualVanId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_VAN}>No usual route</SelectItem>
                    {vansPage?.data.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.plateNumber}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-xs text-muted-foreground">
              A default only — any active vehicle can still be picked for any route during a daily check.
            </p>
          </div>

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
