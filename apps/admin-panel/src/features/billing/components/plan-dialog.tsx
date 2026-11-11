'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@water-supply-crm/ui';
import { NativeSelect } from '../../observability/components/native-select';
import { useCreatePlan, useUpdatePlan } from '../hooks/use-billing';
import type { Plan, PlanInput } from '../api/billing.api';

const limit = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d+$/.test(v), 'Whole number or empty for unlimited');

export const planFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Max 80 characters'),
  description: z.string().max(500, 'Max 500 characters'),
  price: z
    .string()
    .trim()
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Enter a price of 0 or more (max 2 decimals)'),
  interval: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']),
  trialDays: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 365), 'Whole number between 0 and 365'),
  maxCustomers: limit,
  maxDrivers: limit,
  maxVans: limit,
});
export type PlanFormValues = z.infer<typeof planFormSchema>;

const EMPTY: PlanFormValues = {
  name: '',
  description: '',
  price: '',
  interval: 'MONTHLY',
  trialDays: '',
  maxCustomers: '',
  maxDrivers: '',
  maxVans: '',
};

const lim = (n: number | null) => (n === null ? '' : String(n));
const toLimit = (v: string) => (v.trim() === '' ? null : Number(v));

export function toPlanInput(v: PlanFormValues): PlanInput {
  return {
    name: v.name.trim(),
    ...(v.description.trim() ? { description: v.description.trim() } : {}),
    price: Number(v.price),
    interval: v.interval,
    trialDays: v.trialDays.trim() === '' ? 0 : Number(v.trialDays),
    maxCustomers: toLimit(v.maxCustomers),
    maxDrivers: toLimit(v.maxDrivers),
    maxVans: toLimit(v.maxVans),
  };
}

interface Props {
  open: boolean;
  plan: Plan | null;
  onClose: () => void;
}

export function PlanDialog({ open, plan, onClose }: Props) {
  const create = useCreatePlan();
  const update = useUpdatePlan();
  const form = useForm<PlanFormValues>({ resolver: zodResolver(planFormSchema), defaultValues: EMPTY });
  const { register, handleSubmit, reset, formState } = form;
  const { errors } = formState;

  useEffect(() => {
    if (!open) return;
    reset(
      plan
        ? {
            name: plan.name,
            description: plan.description ?? '',
            price: String(Number(plan.price)),
            interval: plan.interval,
            trialDays: String(plan.trialDays),
            maxCustomers: lim(plan.maxCustomers),
            maxDrivers: lim(plan.maxDrivers),
            maxVans: lim(plan.maxVans),
          }
        : EMPTY,
    );
  }, [open, plan, reset]);

  const pending = create.isPending || update.isPending;
  const submit = handleSubmit((v) => {
    const body = toPlanInput(v);
    if (plan) update.mutate({ id: plan.id, body }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  });

  const field = (id: string, label: string, name: keyof PlanFormValues, props: Record<string, unknown> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...register(name)} aria-invalid={!!errors[name]} {...props} />
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
          <DialogTitle>{plan ? `Edit plan: ${plan.name}` : 'New plan'}</DialogTitle>
          <DialogDescription>Leave a limit empty for unlimited. Lowering a limit never deletes vendor data.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" noValidate>
          {field('plan-name', 'Name', 'name')}
          {field('plan-description', 'Description', 'description')}
          <div className="grid gap-3 sm:grid-cols-2">
            {field('plan-price', 'Price (PKR)', 'price', { inputMode: 'decimal' })}
            <div className="space-y-1">
              <Label htmlFor="plan-interval">Billing interval</Label>
              <NativeSelect id="plan-interval" {...register('interval')}>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="YEARLY">Yearly</option>
              </NativeSelect>
            </div>
          </div>
          {field('plan-trial', 'Trial days', 'trialDays', { inputMode: 'numeric', placeholder: '0' })}
          <div className="grid gap-3 sm:grid-cols-3">
            {field('plan-max-customers', 'Max customers', 'maxCustomers', { inputMode: 'numeric', placeholder: 'Unlimited' })}
            {field('plan-max-drivers', 'Max drivers', 'maxDrivers', { inputMode: 'numeric', placeholder: 'Unlimited' })}
            {field('plan-max-vans', 'Max vans', 'maxVans', { inputMode: 'numeric', placeholder: 'Unlimited' })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving...' : plan ? 'Save changes' : 'Create plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
