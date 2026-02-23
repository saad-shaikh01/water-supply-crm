'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MapPin } from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { customerSchema, type CustomerInput } from '../schemas';
import { useCreateCustomer, useUpdateCustomer } from '../hooks/use-customers';
import { useRoutes } from '../../routes/hooks/use-routes';
import { useAllVans } from '../../vans/hooks/use-vans';
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
];

// Parse lat/lng from a Google Maps URL
function parseGoogleMapsLatLng(url: string): { latitude?: number; longitude?: number } {
  try {
    const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) return { latitude: parseFloat(atMatch[1]), longitude: parseFloat(atMatch[2]) };
    const qMatch = url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (qMatch) return { latitude: parseFloat(qMatch[1]), longitude: parseFloat(qMatch[2]) };
  } catch {
    // ignore parse errors
  }
  return {};
}

const EMPTY_DEFAULTS: CustomerInput = {
  name: '',
  phoneNumber: '',
  address: '',
  floor: '',
  nearbyLandmark: '',
  deliveryInstructions: '',
  googleMapsUrl: '',
  routeId: '',
  deliverySchedule: [],
  paymentType: 'CASH',
};

export function CustomerForm({ open, onOpenChange, customer }: CustomerFormProps) {
  const isEdit = !!customer?.id;
  const { mutate: create, isPending: isCreating } = useCreateCustomer();
  const { mutate: update, isPending: isUpdating } = useUpdateCustomer();
  const { data: routesResponse } = useRoutes();
  const { data: vansResponse } = useAllVans();
  const isPending = isCreating || isUpdating;

  const routes = (routesResponse as { data?: any[] } | undefined)?.data ?? [];
  const vans = (vansResponse as { data?: any[] } | undefined)?.data ?? [];
  const activeVans = vans.filter((v: any) => v.isActive !== false);

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: EMPTY_DEFAULTS,
  });

  const deliverySchedule = watch('deliverySchedule') || [];
  const googleMapsUrl = watch('googleMapsUrl');

  useEffect(() => {
    if (open && customer) {
      reset({
        name: String(customer.name ?? ''),
        phoneNumber: String(customer.phoneNumber ?? ''),
        address: String(customer.address ?? ''),
        floor: String(customer.floor ?? ''),
        nearbyLandmark: String(customer.nearbyLandmark ?? ''),
        deliveryInstructions: String(customer.deliveryInstructions ?? ''),
        googleMapsUrl: String(customer.googleMapsUrl ?? ''),
        routeId: String((customer.route as { id?: string } | undefined)?.id ?? customer.routeId ?? ''),
        deliverySchedule: (customer.deliverySchedules as any[] ?? []).map((s: any) => ({
          dayOfWeek: s.dayOfWeek,
          vanId: s.vanId,
          routeSequence: s.routeSequence ?? undefined,
        })),
        paymentType: (customer.paymentType as 'MONTHLY' | 'CASH') ?? 'CASH',
        latitude: customer.latitude ? Number(customer.latitude) : undefined,
        longitude: customer.longitude ? Number(customer.longitude) : undefined,
      });
    } else if (!open) {
      reset(EMPTY_DEFAULTS);
    }
  }, [open, customer, reset]);

  // Auto-parse lat/lng when Google Maps URL changes
  useEffect(() => {
    if (googleMapsUrl) {
      const { latitude, longitude } = parseGoogleMapsLatLng(googleMapsUrl);
      if (latitude !== undefined) setValue('latitude', latitude);
      if (longitude !== undefined) setValue('longitude', longitude);
    }
  }, [googleMapsUrl, setValue]);

  const onSubmit = (data: CustomerInput) => {
    const payload = {
      ...data,
      floor: data.floor || undefined,
      nearbyLandmark: data.nearbyLandmark || undefined,
      deliveryInstructions: data.deliveryInstructions || undefined,
      googleMapsUrl: data.googleMapsUrl || undefined,
    };
    if (isEdit) {
      update({ id: String(customer!.id), data: payload }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(payload, { onSuccess: () => onOpenChange(false) });
    }
  };

  const isDayActive = (day: number) => deliverySchedule.some((s) => s.dayOfWeek === day);

  const toggleDay = (day: number) => {
    const current = [...deliverySchedule];
    const idx = current.findIndex((s) => s.dayOfWeek === day);
    if (idx > -1) {
      current.splice(idx, 1);
    } else {
      current.push({ dayOfWeek: day, vanId: activeVans[0]?.id ?? '', routeSequence: undefined });
    }
    setValue('deliverySchedule', current, { shouldValidate: true });
  };

  const updateDayVan = (day: number, vanId: string) => {
    const current = [...deliverySchedule];
    const idx = current.findIndex((s) => s.dayOfWeek === day);
    if (idx > -1) {
      current[idx] = { ...current[idx], vanId };
      setValue('deliverySchedule', current, { shouldValidate: true });
    }
  };

  const updateDaySequence = (day: number, seq: string) => {
    const current = [...deliverySchedule];
    const idx = current.findIndex((s) => s.dayOfWeek === day);
    if (idx > -1) {
      const parsed = parseInt(seq, 10);
      current[idx] = { ...current[idx], routeSequence: isNaN(parsed) ? undefined : parsed };
      setValue('deliverySchedule', current, { shouldValidate: true });
    }
  };

  const getDayEntry = (day: number) => deliverySchedule.find((s) => s.dayOfWeek === day);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto bg-background/95 backdrop-blur-xl border-l border-border/50">
        <SheetHeader className="pb-6 border-b">
          <SheetTitle className="text-2xl font-bold">{isEdit ? 'Update Customer' : 'New Customer'}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? `Editing ${String(customer?.name ?? '')} · Code: ${String(customer?.customerCode ?? '')}`
              : 'Fill in the details to onboard a new customer. Code is auto-generated.'}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-6 px-1">

          {/* ── Basic Info ─────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Full Name <span className="text-destructive">*</span></Label>
              <Input placeholder="Ahmed Ali" className="bg-accent/30 border-border/50 focus:border-primary/50 transition-all" {...register('name')} />
              {errors.name && <p className="text-[11px] font-medium text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Phone Number <span className="text-destructive">*</span></Label>
              <Input placeholder="0300-1234567" className="bg-accent/30 border-border/50 focus:border-primary/50 transition-all" {...register('phoneNumber')} />
              {errors.phoneNumber && <p className="text-[11px] font-medium text-destructive">{errors.phoneNumber.message}</p>}
            </div>
          </div>

          {/* ── Location ───────────────────────────────── */}
          <div className="space-y-4 p-4 rounded-2xl bg-accent/10 border border-border/30">
            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-primary" /> Location
            </p>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Address <span className="text-destructive">*</span></Label>
              <Input placeholder="House No / Building, Street, Area" className="bg-background/50 border-border/50 focus:border-primary/50 transition-all" {...register('address')} />
              {errors.address && <p className="text-[11px] font-medium text-destructive">{errors.address.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Floor / Unit</Label>
                <Input placeholder="2nd Floor, Flat 3B" className="bg-background/50 border-border/50 focus:border-primary/50 transition-all" {...register('floor')} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Nearby Landmark</Label>
                <Input placeholder="Near McDonald's" className="bg-background/50 border-border/50 focus:border-primary/50 transition-all" {...register('nearbyLandmark')} />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Delivery Instructions</Label>
              <textarea
                placeholder="e.g. Call before arriving, Leave at gate, Ring bell twice..."
                rows={2}
                className="flex w-full rounded-md border border-border/50 bg-background/50 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-all resize-none"
                {...register('deliveryInstructions')}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold flex items-center gap-2">
                Google Maps Link
                <span className="text-[10px] font-normal text-muted-foreground">(auto-extracts coordinates)</span>
              </Label>
              <Input
                placeholder="Paste Google Maps share URL here..."
                className="bg-background/50 border-border/50 focus:border-primary/50 transition-all text-sm"
                {...register('googleMapsUrl')}
              />
              {errors.googleMapsUrl && <p className="text-[11px] font-medium text-destructive">{errors.googleMapsUrl.message}</p>}
              {watch('latitude') && watch('longitude') && (
                <p className="text-[11px] text-emerald-500 font-semibold">
                  ✓ Coordinates detected: {watch('latitude')?.toFixed(5)}, {watch('longitude')?.toFixed(5)}
                </p>
              )}
            </div>
          </div>

          {/* ── Service ────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Route <span className="text-destructive">*</span></Label>
              <Select value={watch('routeId')} onValueChange={(v) => setValue('routeId', v, { shouldValidate: true })}>
                <SelectTrigger className="bg-accent/30 border-border/50 focus:border-primary/50 transition-all">
                  <SelectValue placeholder="Select route" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/50 shadow-2xl">
                  {routes.map((r: any) => (
                    <SelectItem key={r.id} value={r.id} className="rounded-lg">{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.routeId && <p className="text-[11px] font-medium text-destructive">{errors.routeId.message}</p>}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Payment Type <span className="text-destructive">*</span></Label>
              <Select value={watch('paymentType')} onValueChange={(v) => setValue('paymentType', v as 'MONTHLY' | 'CASH', { shouldValidate: true })}>
                <SelectTrigger className="bg-accent/30 border-border/50 focus:border-primary/50 transition-all">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/50 shadow-2xl">
                  <SelectItem value="CASH" className="rounded-lg">Cash (Per Delivery)</SelectItem>
                  <SelectItem value="MONTHLY" className="rounded-lg">Monthly Billing</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Delivery Schedule Builder ───────────────── */}
          <div className="space-y-3 p-4 rounded-2xl bg-accent/10 border border-border/30">
            <Label className="text-sm font-semibold">
              Delivery Schedule <span className="text-destructive">*</span>
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">(select days &amp; assign vans)</span>
            </Label>
            <div className="space-y-2">
              {DAYS.map((day) => {
                const active = isDayActive(day.value);
                const entry = getDayEntry(day.value);
                return (
                  <div key={day.value} className={cn(
                    'flex items-center gap-3 rounded-xl border p-2.5 transition-all',
                    active
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border/40 bg-background/50 opacity-60'
                  )}>
                    {/* Day toggle */}
                    <button
                      type="button"
                      onClick={() => toggleDay(day.value)}
                      className={cn(
                        'min-w-[44px] py-1.5 text-xs font-black rounded-lg border transition-all',
                        active
                          ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                          : 'bg-background text-muted-foreground border-border/50 hover:border-primary/50'
                      )}
                    >
                      {day.label}
                    </button>

                    {active && (
                      <>
                        {/* Van selector */}
                        <div className="flex-1 min-w-0">
                          <Select
                            value={entry?.vanId ?? ''}
                            onValueChange={(v) => updateDayVan(day.value, v)}
                          >
                            <SelectTrigger className="h-8 text-xs bg-background/80 border-border/50">
                              <SelectValue placeholder="Select van..." />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-border/50 shadow-2xl">
                              {activeVans.map((v: any) => (
                                <SelectItem key={v.id} value={v.id} className="text-xs rounded-lg">
                                  {v.plateNumber}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Sequence input */}
                        <div className="w-16">
                          <Input
                            type="number"
                            placeholder="Seq"
                            min={1}
                            className="h-8 text-xs text-center bg-background/80 border-border/50 px-1"
                            value={entry?.routeSequence ?? ''}
                            onChange={(e) => updateDaySequence(day.value, e.target.value)}
                          />
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {errors.deliverySchedule && (
              <p className="text-[11px] font-medium text-destructive">
                {typeof errors.deliverySchedule.message === 'string'
                  ? errors.deliverySchedule.message
                  : 'Add at least one delivery day'}
              </p>
            )}
          </div>

          <SheetFooter className="pt-6 border-t gap-3 sm:gap-0">
            <Button type="button" variant="ghost" className="hover:bg-accent" onClick={() => onOpenChange(false)}>
              Discard
            </Button>
            <Button type="submit" className="min-w-[140px] shadow-lg shadow-primary/20" disabled={isPending}>
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
