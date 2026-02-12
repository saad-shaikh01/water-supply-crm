'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, Button, Input, Label } from '@water-supply-crm/ui';
import { vanSchema, type VanInput } from '../schemas';
import { useCreateVan, useUpdateVan } from '../hooks/use-vans';

interface VanFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  van?: Record<string, unknown> | null;
}

export function VanForm({ open, onOpenChange, van }: VanFormProps) {
  const isEdit = !!van?.id;
  const { mutate: create, isPending: isCreating } = useCreateVan();
  const { mutate: update, isPending: isUpdating } = useUpdateVan();
  const isPending = isCreating || isUpdating;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<VanInput>({
    resolver: zodResolver(vanSchema),
  });

  useEffect(() => {
    if (open && van) {
      reset({ plateNumber: String(van.plateNumber ?? ''), model: String(van.model ?? ''), capacity: Number(van.capacity ?? 0) || undefined });
    } else if (!open) {
      reset({ plateNumber: '', model: '', capacity: undefined });
    }
  }, [open, van, reset]);

  const onSubmit = (data: VanInput) => {
    if (isEdit) {
      update({ id: String(van!.id), data }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(data, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader><SheetTitle>{isEdit ? 'Edit Van' : 'Add Van'}</SheetTitle></SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label>Plate Number</Label>
            <Input placeholder="ABC-1234" {...register('plateNumber')} />
            {errors.plateNumber && <p className="text-sm text-destructive">{errors.plateNumber.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Model</Label>
            <Input placeholder="e.g. Toyota HiAce" {...register('model')} />
          </div>
          <div className="space-y-2">
            <Label>Capacity</Label>
            <Input type="number" min={1} placeholder="Number of units" {...register('capacity', { valueAsNumber: true })} />
          </div>
          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
