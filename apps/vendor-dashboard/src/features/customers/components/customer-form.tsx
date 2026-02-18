'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { customerSchema, type CustomerInput } from '../schemas';
import { useCreateCustomer, useUpdateCustomer } from '../hooks/use-customers';
import { useRoutes } from '../../routes/hooks/use-routes';
import { cn } from '@water-supply-crm/ui';

interface CustomerFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Record<string, unknown> | null;
}

const DAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

export function CustomerForm({ open, onOpenChange, customer }: CustomerFormProps) {
  const isEdit = !!customer?.id;
  const { mutate: create, isPending: isCreating } = useCreateCustomer();
  const { mutate: update, isPending: isUpdating } = useUpdateCustomer();
  const { data: routesResponse } = useRoutes();
  const isPending = isCreating || isUpdating;

  const routes = (routesResponse as { data?: any[] } | undefined)?.data ?? [];

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      customerCode: '',
      name: '',
      phoneNumber: '',
      address: '',
      routeId: '',
      deliveryDays: [],
      paymentType: 'CASH',
    },
  });

  const selectedDays = watch('deliveryDays') || [];

  useEffect(() => {
    if (open && customer) {
      reset({
        customerCode: String(customer.customerCode ?? ''),
        name: String(customer.name ?? ''),
        phoneNumber: String(customer.phoneNumber ?? ''),
        address: String(customer.address ?? ''),
        routeId: String((customer.route as { id?: string } | undefined)?.id ?? customer.routeId ?? ''),
        deliveryDays: (customer.deliveryDays as number[] ?? []),
        paymentType: (customer.paymentType as 'MONTHLY' | 'CASH') ?? 'CASH',
        latitude: customer.latitude ? Number(customer.latitude) : undefined,
        longitude: customer.longitude ? Number(customer.longitude) : undefined,
      });
    } else if (!open) {
      reset({ customerCode: '', name: '', phoneNumber: '', address: '', routeId: '', deliveryDays: [], paymentType: 'CASH' });
    }
  }, [open, customer, reset]);

  const onSubmit = (data: CustomerInput) => {
    if (isEdit) {
      update({ id: String(customer!.id), data }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(data, { onSuccess: () => onOpenChange(false) });
    }
  };

  const toggleDay = (day: number) => {
    const current = [...selectedDays];
    const index = current.indexOf(day);
    if (index > -1) {
      current.splice(index, 1);
    } else {
      current.push(day);
    }
    setValue('deliveryDays', current, { shouldValidate: true });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto bg-background/95 backdrop-blur-xl border-l border-border/50">
        <SheetHeader className="pb-6 border-b">
          <SheetTitle className="text-2xl font-bold">{isEdit ? 'Update Profile' : 'New Customer'}</SheetTitle>
          <SheetDescription>
            {isEdit ? 'Update the details for this customer.' : 'Fill in the information to onboard a new customer.'}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-6 px-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Customer Code</Label>
              <Input
                placeholder="CUST-001"
                className="bg-accent/30 border-border/50 focus:border-primary/50 transition-all"
                {...register('customerCode')}
              />
              {errors.customerCode && <p className="text-[11px] font-medium text-destructive animate-in fade-in slide-in-from-top-1">{errors.customerCode.message}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Full Name</Label>
              <Input
                placeholder="John Doe"
                className="bg-accent/30 border-border/50 focus:border-primary/50 transition-all"
                {...register('name')}
              />
              {errors.name && <p className="text-[11px] font-medium text-destructive animate-in fade-in slide-in-from-top-1">{errors.name.message}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Phone Number</Label>
            <Input
              placeholder="+92 300 1234567"
              className="bg-accent/30 border-border/50 focus:border-primary/50 transition-all"
              {...register('phoneNumber')}
            />
            {errors.phoneNumber && <p className="text-[11px] font-medium text-destructive animate-in fade-in slide-in-from-top-1">{errors.phoneNumber.message}</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Address</Label>
            <Input
              placeholder="Building, Street, Area"
              className="bg-accent/30 border-border/50 focus:border-primary/50 transition-all"
              {...register('address')}
            />
            {errors.address && <p className="text-[11px] font-medium text-destructive animate-in fade-in slide-in-from-top-1">{errors.address.message}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Service Route</Label>
              <Select value={watch('routeId')} onValueChange={(v) => setValue('routeId', v, { shouldValidate: true })}>
                <SelectTrigger className="bg-accent/30 border-border/50 focus:border-primary/50 transition-all">
                  <SelectValue placeholder="Select a route" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/50 shadow-2xl">
                  {routes.map((r: any) => (
                    <SelectItem key={r.id} value={r.id} className="rounded-lg">{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.routeId && <p className="text-[11px] font-medium text-destructive animate-in fade-in slide-in-from-top-1">{errors.routeId.message}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Payment Type</Label>
              <Select value={watch('paymentType')} onValueChange={(v) => setValue('paymentType', v as 'MONTHLY' | 'CASH', { shouldValidate: true })}>
                <SelectTrigger className="bg-accent/30 border-border/50 focus:border-primary/50 transition-all">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/50 shadow-2xl">
                  <SelectItem value="CASH" className="rounded-lg">Cash (Per Delivery)</SelectItem>
                  <SelectItem value="MONTHLY" className="rounded-lg">Monthly Billing</SelectItem>
                </SelectContent>
              </Select>
              {errors.paymentType && <p className="text-[11px] font-medium text-destructive animate-in fade-in slide-in-from-top-1">{errors.paymentType.message}</p>}
            </div>
          </div>

          <div className="space-y-3 p-4 rounded-xl bg-accent/20 border border-border/30">
            <Label className="text-sm font-semibold">Delivery Schedule</Label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((day) => (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => toggleDay(day.value)}
                  className={cn(
                    "flex-1 min-w-[60px] py-2 text-xs font-bold rounded-lg border transition-all duration-200",
                    selectedDays.includes(day.value)
                      ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20 scale-105"
                      : "bg-background text-muted-foreground border-border/50 hover:border-primary/50"
                  )}
                >
                  {day.label}
                </button>
              ))}
            </div>
            {errors.deliveryDays && <p className="text-[11px] font-medium text-destructive animate-in fade-in slide-in-from-top-1">{errors.deliveryDays.message}</p>}
          </div>

          <SheetFooter className="pt-6 border-t gap-3 sm:gap-0">
            <Button type="button" variant="ghost" className="hover:bg-accent" onClick={() => onOpenChange(false)}>
              Discard
            </Button>
            <Button type="submit" className="min-w-[120px] shadow-lg shadow-primary/20" disabled={isPending}>
              {isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Saving...
                </span>
              ) : isEdit ? 'Update Customer' : 'Onboard Customer'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
