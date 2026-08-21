'use client';

import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, FileText } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { VEHICLE_DOCUMENT_TYPE_LABELS } from '@water-supply-crm/types';
import type { VehicleDocumentEntry } from '@water-supply-crm/types';
import { vehicleDocumentSchema, type VehicleDocumentInput } from '../../schemas';
import { useAddVehicleDocument, useUpdateVehicleDocument } from '../../hooks/use-fleet';
import { FleetPhotoUpload } from '../fleet-photo-upload';

interface DocumentFormDialogProps {
  vehicleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document?: VehicleDocumentEntry | null;
}

export function DocumentFormDialog({ vehicleId, open, onOpenChange, document }: DocumentFormDialogProps) {
  const isEdit = !!document;
  const [fileKey, setFileKey] = useState<string | undefined>(document?.fileKey ?? undefined);
  const { mutate: addDocument, isPending: isAdding } = useAddVehicleDocument();
  const { mutate: updateDocument, isPending: isUpdating } = useUpdateVehicleDocument();
  const isPending = isAdding || isUpdating;

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<VehicleDocumentInput>({
    resolver: zodResolver(vehicleDocumentSchema),
    defaultValues: {
      type: document?.type ?? 'REGISTRATION',
      documentNumber: document?.documentNumber ?? '',
      issuingAuthority: document?.issuingAuthority ?? '',
      issueDate: document?.issueDate ? document.issueDate.slice(0, 10) : '',
      expiryDate: document?.expiryDate ? document.expiryDate.slice(0, 10) : '',
      reminderDaysBefore: document?.reminderDaysBefore ?? 30,
      notes: document?.notes ?? '',
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        type: document?.type ?? 'REGISTRATION',
        documentNumber: document?.documentNumber ?? '',
        issuingAuthority: document?.issuingAuthority ?? '',
        issueDate: document?.issueDate ? document.issueDate.slice(0, 10) : '',
        expiryDate: document?.expiryDate ? document.expiryDate.slice(0, 10) : '',
        reminderDaysBefore: document?.reminderDaysBefore ?? 30,
        notes: document?.notes ?? '',
      });
      setFileKey(document?.fileKey ?? undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, document?.id]);

  function onSubmit(values: VehicleDocumentInput) {
    const payload = { ...values, fileKey };
    if (isEdit && document) {
      updateDocument({ id: document.id, data: payload }, { onSuccess: () => onOpenChange(false) });
    } else {
      addDocument({ vehicleId, data: payload }, { onSuccess: () => onOpenChange(false) });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {isEdit ? 'Edit Document' : 'Add Document'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Document Type</Label>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(VEHICLE_DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Document Number</Label>
              <Input className="rounded-xl" {...register('documentNumber')} />
            </div>
            <div className="space-y-2">
              <Label>Issuing Authority</Label>
              <Input className="rounded-xl" {...register('issuingAuthority')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Issue Date</Label>
              <Input type="date" className="rounded-xl" {...register('issueDate')} />
            </div>
            <div className="space-y-2">
              <Label>Expiry Date</Label>
              <Input type="date" className="rounded-xl" {...register('expiryDate')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Remind me (days before expiry)</Label>
            <Input
              type="number"
              className="rounded-xl"
              {...register('reminderDaysBefore', { valueAsNumber: true })}
            />
            {errors.reminderDaysBefore && (
              <p className="text-xs text-destructive">{errors.reminderDaysBefore.message}</p>
            )}
          </div>

          <FleetPhotoUpload label="Document Scan" maxPhotos={1} onPhotosChange={(keys) => setFileKey(keys[0])} />

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
              {isEdit ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
