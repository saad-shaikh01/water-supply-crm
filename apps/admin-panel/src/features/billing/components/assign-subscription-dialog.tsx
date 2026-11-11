'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@water-supply-crm/ui';
import { NativeSelect } from '../../observability/components/native-select';
import { VendorSelect } from '../../vendor-picker/vendor-select';
import { useAssignSubscription, usePlans } from '../hooks/use-billing';
import type { AssignSubscriptionInput } from '../api/billing.api';

const optInt = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d+$/.test(v), 'Whole number, or empty to keep the plan value');

export const assignSchema = z.object({
  vendorId: z.string().min(1, 'Select a vendor'),
  planId: z.string().min(1, 'Select a plan'),
  startTrial: z.boolean(),
  trialDays: z.string().trim().refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 365), 'Whole number between 0 and 365'),
  maxCustomers: optInt,
  maxDrivers: optInt,
  maxVans: optInt,
  notes: z.string().max(1000, 'Max 1000 characters'),
});
type Values = z.infer<typeof assignSchema>;

const EMPTY: Values = { vendorId: '', planId: '', startTrial: false, trialDays: '', maxCustomers: '', maxDrivers: '', maxVans: '', notes: '' };

export function toAssignBody(v: Values): AssignSubscriptionInput {
  const overrides: AssignSubscriptionInput['overrides'] = {};
  if (v.maxCustomers.trim() !== '') overrides.maxCustomers = Number(v.maxCustomers);
  if (v.maxDrivers.trim() !== '') overrides.maxDrivers = Number(v.maxDrivers);
  if (v.maxVans.trim() !== '') overrides.maxVans = Number(v.maxVans);
  return {
    planId: v.planId,
    ...(v.startTrial ? { startTrial: true } : {}),
    ...(v.startTrial && v.trialDays.trim() !== '' ? { trialDays: Number(v.trialDays) } : {}),
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
  };
}

interface Props {
  open: boolean;
  /** Pre-selected vendor when changing an existing subscription. */
  vendor?: { id: string; name: string } | null;
  currentPlanId?: string;
  onClose: () => void;
}

export function AssignSubscriptionDialog({ open, vendor, currentPlanId, onClose }: Props) {
  const plans = usePlans();
  const assign = useAssignSubscription();
  const { register, handleSubmit, reset, setValue, watch, formState } = useForm<Values>({
    resolver: zodResolver(assignSchema),
    defaultValues: EMPTY,
  });
  const { errors } = formState;

  useEffect(() => {
    if (open) reset({ ...EMPTY, vendorId: vendor?.id ?? '', planId: currentPlanId ?? '' });
  }, [open, vendor, currentPlanId, reset]);

  const startTrial = watch('startTrial');
  const submit = handleSubmit((v) => assign.mutate({ vendorId: v.vendorId, body: toAssignBody(v) }, { onSuccess: onClose }));

  // Inactive plans can only stay on a vendor that already has them.
  const options = (plans.data ?? []).filter((p) => p.isActive || p.id === currentPlanId);

  const numField = (id: string, label: string, name: 'maxCustomers' | 'maxDrivers' | 'maxVans' | 'trialDays') => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="numeric" placeholder="Plan default" {...register(name)} aria-invalid={!!errors[name]} />
      {errors[name] && (
        <p className="text-xs text-destructive" role="alert">
          {errors[name]?.message as string}
        </p>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{vendor ? `Change plan for ${vendor.name}` : 'Assign plan'}</DialogTitle>
          <DialogDescription>Downgrading below current usage is allowed; data is kept and new records are blocked.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <VendorSelect
            id="sub-vendor"
            value={watch('vendorId')}
            onChange={(id) => setValue('vendorId', id, { shouldValidate: true })}
            disabled={!!vendor}
            selectedName={vendor?.name}
            error={errors.vendorId?.message}
          />
          <div className="space-y-1">
            <Label htmlFor="sub-plan">Plan</Label>
            <NativeSelect id="sub-plan" {...register('planId')} aria-invalid={!!errors.planId}>
              <option value="">Select a plan</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
            {errors.planId && (
              <p className="text-xs text-destructive" role="alert">
                {errors.planId.message}
              </p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" id="sub-start-trial" {...register('startTrial')} /> Start a (new) trial
          </label>
          {startTrial && numField('sub-trial-days', 'Trial days', 'trialDays')}
          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Limit overrides (leave empty to use the plan value)</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {numField('sub-max-customers', 'Customers', 'maxCustomers')}
              {numField('sub-max-drivers', 'Drivers', 'maxDrivers')}
              {numField('sub-max-vans', 'Vans', 'maxVans')}
            </div>
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="sub-notes">Notes</Label>
            <Input id="sub-notes" {...register('notes')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={assign.isPending}>
              {assign.isPending ? 'Saving...' : 'Save subscription'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
