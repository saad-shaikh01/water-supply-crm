'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Wrench } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { VEHICLE_SERVICE_TYPE_LABELS } from '@water-supply-crm/types';
import { serviceRecordSchema, type ServiceRecordInput } from '../../schemas';
import { useCreateServiceRecord } from '../../hooks/use-maintenance';
import { FleetPhotoUpload } from '../fleet-photo-upload';

interface ServiceRecordFormDialogProps {
  vehicleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultServiceType?: string;
  currentOdometer?: number;
}

export function ServiceRecordFormDialog({
  vehicleId,
  open,
  onOpenChange,
  defaultServiceType,
  currentOdometer,
}: ServiceRecordFormDialogProps) {
  const [invoicePhotoKey, setInvoicePhotoKey] = useState<string | undefined>(undefined);
  const { mutate: createServiceRecord, isPending } = useCreateServiceRecord();

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<ServiceRecordInput>({
    resolver: zodResolver(serviceRecordSchema),
    defaultValues: {
      serviceType: (defaultServiceType as ServiceRecordInput['serviceType']) ?? 'ENGINE_OIL',
      performedAtOdometer: currentOdometer ?? 0,
      performedAtDate: new Date().toISOString().slice(0, 10),
      cost: 0,
      workshopName: '',
      partsReplaced: '',
      notes: '',
    },
  });

  function onSubmit(values: ServiceRecordInput) {
    createServiceRecord(
      { vehicleId, ...values, invoicePhotoKey },
      {
        onSuccess: () => {
          onOpenChange(false);
          reset();
          setInvoicePhotoKey(undefined);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Wrench className="h-5 w-5 text-primary" />
            Record Service
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Service Type</Label>
            <Controller
              name="serviceType"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(VEHICLE_SERVICE_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Odometer (km)</Label>
              <Input type="number" className="rounded-xl" {...register('performedAtOdometer', { valueAsNumber: true })} />
              {errors.performedAtOdometer && <p className="text-xs text-destructive">{errors.performedAtOdometer.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" className="rounded-xl" {...register('performedAtDate')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Cost (₨)</Label>
            <Input type="number" className="rounded-xl" {...register('cost', { valueAsNumber: true })} />
            {errors.cost && <p className="text-xs text-destructive">{errors.cost.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Workshop</Label>
            <Input className="rounded-xl" {...register('workshopName')} />
          </div>

          <div className="space-y-2">
            <Label>Parts Replaced</Label>
            <Input className="rounded-xl" {...register('partsReplaced')} />
          </div>

          <FleetPhotoUpload label="Invoice" maxPhotos={1} onPhotosChange={(keys) => setInvoicePhotoKey(keys[0])} />

          <div className="space-y-2">
            <Label>Notes</Label>
            <Input className="rounded-xl" {...register('notes')} />
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
