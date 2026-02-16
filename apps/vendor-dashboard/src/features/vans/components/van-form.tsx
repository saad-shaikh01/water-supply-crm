'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@water-supply-crm/ui';
import { vanSchema, type VanInput } from '../schemas';
import { useCreateVan, useUpdateVan } from '../hooks/use-vans';
import { useUsers } from '../../users/hooks/use-users';
import { Truck, User } from 'lucide-react';

interface VanFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  van?: Record<string, unknown> | null;
}

export function VanForm({ open, onOpenChange, van }: VanFormProps) {
  const isEdit = !!van?.id;
  const { mutate: create, isPending: isCreating } = useCreateVan();
  const { mutate: update, isPending: isUpdating } = useUpdateVan();
  const { data: users } = useUsers();
  const isPending = isCreating || isUpdating;

  const drivers = ((users ?? []) as Array<{ id: string; name: string; role: string }>).filter(u => u.role === 'DRIVER');

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<VanInput>({
    resolver: zodResolver(vanSchema),
    defaultValues: { plateNumber: '', defaultDriverId: null },
  });

  useEffect(() => {
    if (open && van) {
      reset({ 
        plateNumber: String(van.plateNumber ?? ''), 
        defaultDriverId: van.defaultDriverId ? String(van.defaultDriverId) : null 
      });
    } else if (!open) {
      reset({ plateNumber: '', defaultDriverId: null });
    }
  }, [open, van, reset]);

  const onSubmit = (data: VanInput) => {
    const payload = {
      ...data,
      defaultDriverId: data.defaultDriverId || undefined
    };
    
    if (isEdit) {
      update({ id: String(van!.id), data: payload }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(payload, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md bg-background/95 backdrop-blur-xl border-l border-border/50">
        <SheetHeader className="pb-6 border-b">
          <SheetTitle className="text-2xl font-bold flex items-center gap-2">
            <Truck className="h-6 w-6 text-primary" />
            {isEdit ? 'Update Van' : 'Register Van'}
          </SheetTitle>
          <SheetDescription>
            {isEdit ? 'Update the details for this vehicle.' : 'Add a new vehicle to your delivery fleet.'}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-8">
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Plate Number</Label>
            <Input 
              placeholder="ABC-1234" 
              className="bg-accent/30 border-border/50 h-11 focus:border-primary/50 transition-all uppercase"
              {...register('plateNumber')} 
            />
            {errors.plateNumber && <p className="text-xs font-medium text-destructive">{errors.plateNumber.message}</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Default Driver</Label>
            <Select 
              value={watch('defaultDriverId') || 'none'} 
              onValueChange={(v) => setValue('defaultDriverId', v === 'none' ? null : v)}
            >
              <SelectTrigger className="bg-accent/30 border-border/50 h-11 focus:border-primary/50 transition-all">
                <SelectValue placeholder="Assign a default driver" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No default driver</SelectItem>
                {drivers.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    <div className="flex items-center gap-2">
                      <User className="h-3 w-3" />
                      {d.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              The assigned driver will be automatically selected for new daily sheets.
            </p>
          </div>

          <SheetFooter className="pt-6 border-t gap-3 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Discard
            </Button>
            <Button type="submit" className="min-w-[120px] shadow-lg shadow-primary/20" disabled={isPending}>
              {isPending ? 'Saving...' : isEdit ? 'Update Vehicle' : 'Register Vehicle'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
