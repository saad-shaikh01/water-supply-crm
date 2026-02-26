'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { routeSchema, type RouteInput } from '../schemas';
import { useCreateRoute, useUpdateRoute } from '../hooks/use-routes';
import { useAllVans } from '../../vans/hooks/use-vans';

interface RouteFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  route?: Record<string, unknown> | null;
}

export function RouteForm({ open, onOpenChange, route }: RouteFormProps) {
  const isEdit = !!route?.id;
  const { mutate: create, isPending: isCreating } = useCreateRoute();
  const { mutate: update, isPending: isUpdating } = useUpdateRoute();
  const { data: vansResponse } = useAllVans();
  const isPending = isCreating || isUpdating;

  const vans = (vansResponse as { data?: any[] } | undefined)?.data ?? [];

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<RouteInput>({
    resolver: zodResolver(routeSchema),
  });

  useEffect(() => {
    if (open && route) {
      reset({
        name: String(route.name ?? ''),
        defaultVanId: String((route.defaultVan as { id?: string } | undefined)?.id ?? route.defaultVanId ?? ''),
      });
    } else if (!open) {
      reset({ name: '', defaultVanId: '' });
    }
  }, [open, route, reset]);

  const onSubmit = (data: RouteInput) => {
    const payload = { ...data, defaultVanId: data.defaultVanId || undefined };
    if (isEdit) {
      update({ id: String(route!.id), data: payload }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(payload, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader><SheetTitle>{isEdit ? 'Edit Route' : 'Add Route'}</SheetTitle></SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="Route name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Default Van</Label>
            <Select
              value={watch('defaultVanId') || ''}
              onValueChange={(v) => setValue('defaultVanId', v === 'none' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a van (required for sheet generation)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No default van</SelectItem>
                {vans.map((v: any) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.plateNumber} {v.model ? `— ${v.model}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">A default van is required for automatic daily sheet generation.</p>
          </div>
          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
