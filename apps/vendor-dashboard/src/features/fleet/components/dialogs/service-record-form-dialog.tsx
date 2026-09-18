'use client';

import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, Settings2, Wrench } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { VEHICLE_SERVICE_TYPE_LABELS, type VehicleServiceRecordEntry } from '@water-supply-crm/types';
import { serviceRecordSchema, type ServiceRecordInput } from '../../schemas';
import { useCreateServiceRecord, useServiceTypes, useUpdateServiceRecord } from '../../hooks/use-maintenance';
import { FleetPhotoUpload } from '../fleet-photo-upload';
import { ManageServiceTypesDialog } from './manage-service-types-dialog';

// Sentinel <SelectItem> value that opens the "add a service type" dialog
// instead of selecting anything.
const ADD_NEW_TYPE = '__add_new_type__';

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
  const [manageTypesOpen, setManageTypesOpen] = useState(false);
  const { data: serviceTypes, isLoading: typesLoading } = useServiceTypes();
  // Until the catalogue loads, show the built-ins so the select isn't blank.
  const typeOptions = serviceTypes?.length
    ? serviceTypes.map((t) => ({ key: t.key, label: t.label }))
    : Object.entries(VEHICLE_SERVICE_TYPE_LABELS).map(([key, label]) => ({ key, label }));

  const { register, handleSubmit, reset, control, watch, setValue, getValues, formState: { errors } } = useForm<ServiceRecordInput>({
    resolver: zodResolver(serviceRecordSchema),
    defaultValues: {
      serviceType: defaultServiceType ?? 'ENGINE_OIL',
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
        serviceType: defaultServiceType ?? 'ENGINE_OIL',
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

  // Create mode: if the pre-selected type no longer exists in the vendor's
  // catalogue (e.g. the default "Engine Oil" was removed), fall back to the
  // first available one rather than submitting a dead key.
  const selectedType = watch('serviceType');
  useEffect(() => {
    if (!open || isEdit || !serviceTypes?.length) return;
    if (selectedType && !serviceTypes.some((t) => t.key === selectedType)) {
      setValue('serviceType', serviceTypes[0].key);
    }
  }, [open, isEdit, serviceTypes, selectedType, setValue]);

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
            <div className="flex items-center justify-between">
              <Label>Service Type</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => setManageTypesOpen(true)}
              >
                <Settings2 className="h-3 w-3" />
                Manage
              </Button>
            </div>
            <Controller
              name="serviceType"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) => (v === ADD_NEW_TYPE ? setManageTypesOpen(true) : field.onChange(v))}
                  disabled={typesLoading && !isEdit}
                >
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {typeOptions.map(({ key, label }) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                    <SelectSeparator />
                    <SelectItem value={ADD_NEW_TYPE} className="text-primary font-semibold">
                      <span className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add new service type…</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {errors.serviceType && <p className="text-xs text-destructive">{errors.serviceType.message}</p>}
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

      <ManageServiceTypesDialog
        open={manageTypesOpen}
        onOpenChange={setManageTypesOpen}
        // Newly added type is what the user wanted to record — select it.
        onCreated={(created) => setValue('serviceType', created.key, { shouldValidate: true })}
        onDeleted={(removed) => {
          if (getValues('serviceType') === removed.key) setValue('serviceType', '');
        }}
      />
    </Dialog>
  );
}
