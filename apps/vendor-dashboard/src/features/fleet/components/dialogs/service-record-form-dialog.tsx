'use client';

import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Wrench } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { VEHICLE_SERVICE_TYPE_LABELS, type VehicleServiceRecordEntry } from '@water-supply-crm/types';
import { serviceRecordSchema, type ServiceRecordInput } from '../../schemas';
import { useCreateServiceRecord, useUpdateServiceRecord } from '../../hooks/use-maintenance';
import { FleetPhotoUpload } from '../fleet-photo-upload';

interface ServiceRecordFormDialogProps {
  vehicleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultServiceType?: string;
  currentOdometer?: number;
  // Edit mode — passed by the Expense Center detail drawer (Phase 2b) with
  // the full record fetched via `useServiceRecord(sourceRecordId)`. When
  // present, every field prefills from it, the title/submit label switch to
  // "Edit"/"Save changes", and submit calls `useUpdateServiceRecord` instead
  // of create. Absent (create mode, the original behaviour) this is fully
  // unchanged.
  serviceRecord?: VehicleServiceRecordEntry;
}

export function ServiceRecordFormDialog({
  vehicleId,
  open,
  onOpenChange,
  defaultServiceType,
  currentOdometer,
  serviceRecord,
}: ServiceRecordFormDialogProps) {
  const isEdit = !!serviceRecord;
  const [invoicePhotoKey, setInvoicePhotoKey] = useState<string | undefined>(undefined);
  const { mutate: createServiceRecord, isPending: isCreating } = useCreateServiceRecord();
  const { mutate: updateServiceRecord, isPending: isUpdating } = useUpdateServiceRecord();
  const isPending = isCreating || isUpdating;

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

  useEffect(() => {
    if (open && serviceRecord) {
      reset({
        serviceType: serviceRecord.serviceType,
        performedAtOdometer: serviceRecord.performedAtOdometer,
        performedAtDate: serviceRecord.performedAtDate.slice(0, 10),
        cost: serviceRecord.cost,
        workshopName: serviceRecord.workshopName ?? '',
        partsReplaced: serviceRecord.partsReplaced ?? '',
        notes: serviceRecord.notes ?? '',
      });
      setInvoicePhotoKey(serviceRecord.invoicePhotoKey ?? undefined);
    } else if (open && !serviceRecord) {
      reset({
        serviceType: (defaultServiceType as ServiceRecordInput['serviceType']) ?? 'ENGINE_OIL',
        performedAtOdometer: currentOdometer ?? 0,
        performedAtDate: new Date().toISOString().slice(0, 10),
        cost: 0,
        workshopName: '',
        partsReplaced: '',
        notes: '',
      });
      setInvoicePhotoKey(undefined);
    }
  }, [open, serviceRecord, defaultServiceType, currentOdometer, reset]);

  function onSubmit(values: ServiceRecordInput) {
    if (isEdit) {
      updateServiceRecord(
        { id: serviceRecord!.id, data: { ...values, invoicePhotoKey } },
        { onSuccess: () => onOpenChange(false) },
      );
      return;
    }
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
            {isEdit ? 'Edit Service Record' : 'Record Service'}
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
              {isEdit ? 'Save changes' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
