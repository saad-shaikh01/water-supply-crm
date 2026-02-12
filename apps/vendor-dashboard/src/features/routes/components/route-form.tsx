'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { routeSchema, type RouteInput } from '../schemas';
import { useCreateRoute, useUpdateRoute } from '../hooks/use-routes';

interface RouteFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  route?: Record<string, unknown> | null;
}

export function RouteForm({ open, onOpenChange, route }: RouteFormProps) {
  const isEdit = !!route?.id;
  const { mutate: create, isPending: isCreating } = useCreateRoute();
  const { mutate: update, isPending: isUpdating } = useUpdateRoute();
  const isPending = isCreating || isUpdating;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<RouteInput>({
    resolver: zodResolver(routeSchema),
  });

  useEffect(() => {
    if (open && route) {
      reset({ name: String(route.name ?? ''), description: String(route.description ?? '') });
    } else if (!open) {
      reset({ name: '', description: '' });
    }
  }, [open, route, reset]);

  const onSubmit = (data: RouteInput) => {
    if (isEdit) {
      update({ id: String(route!.id), data }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(data, { onSuccess: () => onOpenChange(false) });
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
            <Label>Description</Label>
            <Input placeholder="Optional description" {...register('description')} />
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
