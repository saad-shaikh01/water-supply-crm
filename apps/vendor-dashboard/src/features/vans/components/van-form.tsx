'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@water-supply-crm/ui';
import { vanSchema, type VanInput } from '../schemas';
import { useCreateVan, useUpdateVan, useUpdateVanDefaultCrew } from '../hooks/use-vans';
import { useAllDrivers } from '../../users/hooks/use-users';
import {
  CrewEditor, crewArrayToSelection, crewSelectionToArray, emptyCrewSelection,
  type CrewSelection,
} from '../../../components/shared/crew-editor';
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
  const { mutate: updateCrew, isPending: isSavingCrew } = useUpdateVanDefaultCrew();
  const { data: driversResponse } = useAllDrivers();
  const isPending = isCreating || isUpdating || isSavingCrew;

  const drivers = (driversResponse as { data?: any[] } | undefined)?.data ?? [];

  const [crew, setCrew] = useState<CrewSelection>(emptyCrewSelection);

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
      setCrew(crewArrayToSelection(van.defaultCrew as Array<{ userId: string; role: string }> | undefined));
    } else if (!open) {
      reset({ plateNumber: '', defaultDriverId: null });
      setCrew(emptyCrewSelection);
    }
  }, [open, van, reset]);

  const onSubmit = (data: VanInput) => {
    const payload = {
      ...data,
      // Send explicit null when clearing driver on edit; undefined for create
      defaultDriverId: isEdit
        ? (data.defaultDriverId || null)
        : (data.defaultDriverId || undefined),
    };

    const saveCrew = (vanId: string) =>
      updateCrew(
        { id: vanId, crew: crewSelectionToArray(crew) },
        { onSuccess: () => onOpenChange(false) },
      );

    if (isEdit) {
      update({ id: String(van!.id), data: payload }, { onSuccess: () => saveCrew(String(van!.id)) });
    } else {
      create(payload, { onSuccess: (res: any) => saveCrew(String(res?.data?.id)) });
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

          <div className="space-y-2 p-4 rounded-2xl bg-accent/20 border border-border/30">
            <CrewEditor
              value={crew}
              onChange={setCrew}
              excludeUserId={watch('defaultDriverId')}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              The default crew is copied onto each generated daily sheet and confirmed there each morning.
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
