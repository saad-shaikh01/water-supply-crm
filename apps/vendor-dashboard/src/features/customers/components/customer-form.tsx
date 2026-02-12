'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { customerSchema, type CustomerInput } from '../schemas';
import { useCreateCustomer, useUpdateCustomer } from '../hooks/use-customers';
import { useRoutes } from '../../routes/hooks/use-routes';

interface CustomerFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Record<string, unknown> | null;
}

export function CustomerForm({ open, onOpenChange, customer }: CustomerFormProps) {
  const isEdit = !!customer?.id;
  const { mutate: create, isPending: isCreating } = useCreateCustomer();
  const { mutate: update, isPending: isUpdating } = useUpdateCustomer();
  const { data: routes } = useRoutes();
  const isPending = isCreating || isUpdating;

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: { name: '', phone: '', address: '', routeId: '', bottleCount: 0 },
  });

  useEffect(() => {
    if (open && customer) {
      reset({
        name: String(customer.name ?? ''),
        phone: String(customer.phone ?? ''),
        address: String(customer.address ?? ''),
        routeId: String((customer.route as { id?: string } | undefined)?.id ?? customer.routeId ?? ''),
        bottleCount: Number(customer.bottleCount ?? 0),
      });
    } else if (!open) {
      reset({ name: '', phone: '', address: '', routeId: '', bottleCount: 0 });
    }
  }, [open, customer, reset]);

  const onSubmit = (data: CustomerInput) => {
    if (isEdit) {
      update({ id: String(customer!.id), data }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(data, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit Customer' : 'Add Customer'}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="Customer name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input placeholder="+1234567890" {...register('phone')} />
            {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Input placeholder="123 Main St" {...register('address')} />
            {errors.address && <p className="text-sm text-destructive">{errors.address.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Route</Label>
            <Select value={watch('routeId')} onValueChange={(v) => setValue('routeId', v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select route" />
              </SelectTrigger>
              <SelectContent>
                {((routes ?? []) as Array<{ id: string; name: string }>).map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.routeId && <p className="text-sm text-destructive">{errors.routeId.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Bottle Count</Label>
            <Input type="number" min={0} {...register('bottleCount', { valueAsNumber: true })} />
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
