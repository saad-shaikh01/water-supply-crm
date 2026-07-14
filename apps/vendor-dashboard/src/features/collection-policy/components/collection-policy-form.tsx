'use client';

import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Card, CardContent, CardHeader, CardTitle, Button, Input, Label, cn,
} from '@water-supply-crm/ui';
import { ShieldCheck, Percent, Banknote } from 'lucide-react';
import type { CollectionPolicy } from '@water-supply-crm/types';
import { collectionPolicySchema, type CollectionPolicyInput } from '../schemas';
import { useUpdateCollectionPolicy } from '../hooks/use-collection-policy';

/** Same visual toggle used on the Notification Controls page, for consistency. */
function Toggle({
  enabled,
  onToggle,
  disabled,
  label,
}: {
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        enabled ? 'bg-emerald-500' : 'bg-input dark:bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform',
          enabled ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

interface CollectionPolicyFormProps {
  policy: CollectionPolicy;
}

export function CollectionPolicyForm({ policy }: CollectionPolicyFormProps) {
  const { mutate: update, isPending } = useUpdateCollectionPolicy();

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    formState: { errors },
  } = useForm<CollectionPolicyInput>({
    resolver: zodResolver(collectionPolicySchema),
    defaultValues: policy,
  });

  // Re-sync the form whenever fresh server data arrives (initial load, and
  // after a successful save re-fetches via query invalidation).
  useEffect(() => {
    reset(policy);
  }, [policy, reset]);

  const enabled = watch('enabled');

  const onSubmit = (data: CollectionPolicyInput) => update(data);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Minimum Collection Policy
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Prevent drivers from saving a Monthly customer&apos;s delivery when the cash collected
          is less than the minimum required against that customer&apos;s remaining previous
          month outstanding balance. Cash Collected = 0 is always allowed and is never blocked.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="flex items-center justify-between rounded-xl border border-border/50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Enable Collection Policy</p>
              <p className="text-xs text-muted-foreground">
                When off, drivers can save any cash amount exactly as today — nothing changes.
              </p>
            </div>
            <Controller
              name="enabled"
              control={control}
              render={({ field }) => (
                <Toggle
                  enabled={field.value}
                  disabled={isPending}
                  label="Enable Collection Policy"
                  onToggle={() => field.onChange(!field.value)}
                />
              )}
            />
          </div>

          <div className={cn('grid gap-6 sm:grid-cols-3 transition-opacity', !enabled && 'opacity-60')}>
            <div className="space-y-2">
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5 text-muted-foreground" />
                Minimum Outstanding Threshold (₨)
              </Label>
              <Input
                type="number"
                min={0}
                step="1"
                disabled={!enabled}
                className="bg-accent/30 border-border/50 h-11 font-mono font-bold"
                {...register('minOutstandingThreshold', { valueAsNumber: true })}
              />
              {errors.minOutstandingThreshold && (
                <p className="text-xs font-medium text-destructive">
                  {errors.minOutstandingThreshold.message}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Policy only applies when the customer&apos;s remaining previous month balance is
                at least this amount.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Percent className="h-3.5 w-3.5 text-muted-foreground" />
                Minimum Collection Percentage (%)
              </Label>
              <Input
                type="number"
                min={0}
                max={100}
                step="1"
                disabled={!enabled}
                className="bg-accent/30 border-border/50 h-11 font-mono font-bold"
                {...register('minCollectionPercentage', { valueAsNumber: true })}
              />
              {errors.minCollectionPercentage && (
                <p className="text-xs font-medium text-destructive">
                  {errors.minCollectionPercentage.message}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                The minimum percentage of the remaining balance the driver must collect.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5 text-muted-foreground" />
                Allowed Shortfall (₨)
              </Label>
              <Input
                type="number"
                min={0}
                step="1"
                disabled={!enabled}
                className="bg-accent/30 border-border/50 h-11 font-mono font-bold"
                {...register('allowedShortfall', { valueAsNumber: true })}
              />
              {errors.allowedShortfall && (
                <p className="text-xs font-medium text-destructive">
                  {errors.allowedShortfall.message}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Reduces the required amount by this much below the exact percentage.
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-border/50">
            <Button type="submit" disabled={isPending} className="min-w-[140px] shadow-lg shadow-primary/20">
              {isPending ? 'Saving...' : 'Save Policy'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
