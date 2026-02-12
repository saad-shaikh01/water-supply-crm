'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { generateSheetSchema, type GenerateSheetInput } from '../schemas';
import { useGenerateSheet } from '../hooks/use-daily-sheets';
import { useRoutes } from '../../routes/hooks/use-routes';
import { useVans } from '../../vans/hooks/use-vans';
import { useUsers } from '../../users/hooks/use-users';

interface SheetGenerateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SheetGenerate({ open, onOpenChange }: SheetGenerateProps) {
  const { mutate: generate, isPending } = useGenerateSheet();
  const { data: routes } = useRoutes();
  const { data: vans } = useVans();
  const { data: users } = useUsers();

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<GenerateSheetInput>({
    resolver: zodResolver(generateSheetSchema),
    defaultValues: { date: new Date().toISOString().split('T')[0] },
  });

  const drivers = ((users ?? []) as Array<{ id: string; name: string; role: string }>).filter((u) => u.role === 'DRIVER');

  const onSubmit = (data: GenerateSheetInput) => {
    generate(data, { onSuccess: () => { reset(); onOpenChange(false); } });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader><SheetTitle>Generate Daily Sheet</SheetTitle></SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label>Date</Label>
            <Input type="date" {...register('date')} />
            {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Route</Label>
            <Select value={watch('routeId')} onValueChange={(v) => setValue('routeId', v)}>
              <SelectTrigger><SelectValue placeholder="Select route" /></SelectTrigger>
              <SelectContent>
                {((routes ?? []) as Array<{ id: string; name: string }>).map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.routeId && <p className="text-sm text-destructive">{errors.routeId.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Van</Label>
            <Select value={watch('vanId')} onValueChange={(v) => setValue('vanId', v)}>
              <SelectTrigger><SelectValue placeholder="Select van" /></SelectTrigger>
              <SelectContent>
                {((vans ?? []) as Array<{ id: string; plateNumber: string }>).map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.plateNumber}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.vanId && <p className="text-sm text-destructive">{errors.vanId.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Driver</Label>
            <Select value={watch('driverId')} onValueChange={(v) => setValue('driverId', v)}>
              <SelectTrigger><SelectValue placeholder="Select driver" /></SelectTrigger>
              <SelectContent>
                {drivers.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.driverId && <p className="text-sm text-destructive">{errors.driverId.message}</p>}
          </div>
          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending ? 'Generating...' : 'Generate'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
