'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Card, CardContent, CardHeader, CardTitle, Button, Input, Label, cn,
} from '@water-supply-crm/ui';
import { Wallet, Layers, Banknote, ShieldAlert, Info, Loader2 } from 'lucide-react';
import type { CashCollectionPolicy } from '@water-supply-crm/types';
import { cashCollectionPolicySchema, type CashCollectionPolicyInput } from '../schemas';
import { useUpdateCashCollectionPolicy, useCashCollectionPolicyImpact } from '../hooks/use-collection-policy';
import type { CashCollectionPolicyImpactParams } from '../api/collection-policy.api';

/** Same visual toggle used elsewhere on this page, for consistency. */
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

/**
 * Pure display arithmetic for the live worked-example panel (§8.1: "Include
 * the §4.4-A/B mini-example rendered from the entered values"). Mirrors the
 * evaluator's compute step (§4.2, §4.8) exactly, but this is a UI preview
 * only — the real gate lives in the backend evaluator, never here.
 */
function requiredForBalance(
  balance: number,
  N: number,
  floor: number,
  ceiling: number | null,
): number {
  if (balance <= floor) return 0;
  const proportional = balance / (N + 1);
  const ceilingTerm = ceiling != null ? balance - ceiling : 0;
  const raw = Math.min(Math.max(Math.max(proportional, ceilingTerm), 0), balance);
  return Math.floor(raw / 10) * 10;
}

/** Illustrative bill used only for the settings-page preview table, matching §4.4's own worked examples. */
const EXAMPLE_BILL = 300;

interface CashCollectionPolicyFormProps {
  policy: CashCollectionPolicy;
}

export function CashCollectionPolicyForm({ policy }: CashCollectionPolicyFormProps) {
  const { mutate: update, isPending } = useUpdateCashCollectionPolicy();

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    formState: { errors },
  } = useForm<CashCollectionPolicyInput>({
    resolver: zodResolver(cashCollectionPolicySchema),
    defaultValues: policy,
  });

  useEffect(() => {
    reset(policy);
  }, [policy, reset]);

  const enabled = watch('enabled');
  const allowedCreditDeliveries = watch('allowedCreditDeliveries');
  const minExposureFloor = watch('minExposureFloor');
  const maxOutstandingCeiling = watch('maxOutstandingCeiling');

  // Debounced impact-hint params (§21.1's mandatory rollout guard, §22.6:
  // "live, debounced"). Mirrors the existing draft-write debounce idiom used
  // elsewhere in this codebase (delivery-record-form.tsx).
  const [debouncedParams, setDebouncedParams] = useState<CashCollectionPolicyImpactParams | null>(null);
  useEffect(() => {
    const valid =
      Number.isInteger(allowedCreditDeliveries) &&
      allowedCreditDeliveries >= 0 &&
      allowedCreditDeliveries <= 10 &&
      Number.isFinite(minExposureFloor) &&
      minExposureFloor >= 0 &&
      (maxOutstandingCeiling == null || maxOutstandingCeiling >= minExposureFloor);

    const timeout = setTimeout(() => {
      setDebouncedParams(
        valid
          ? {
              allowedCreditDeliveries,
              minExposureFloor,
              ...(maxOutstandingCeiling != null ? { maxOutstandingCeiling } : {}),
            }
          : null,
      );
    }, 400);
    return () => clearTimeout(timeout);
  }, [allowedCreditDeliveries, minExposureFloor, maxOutstandingCeiling]);

  const { data: impact, isFetching: impactLoading } = useCashCollectionPolicyImpact(debouncedParams);

  // Live worked-example rows (§4.4-A/B style) — recomputed on every keystroke,
  // purely for display; never sent anywhere.
  const exampleRows = useMemo(() => {
    const N = Number.isInteger(allowedCreditDeliveries) ? allowedCreditDeliveries : 0;
    const floor = Number.isFinite(minExposureFloor) ? minExposureFloor : 0;
    const ceiling = maxOutstandingCeiling ?? null;
    const window = N * EXAMPLE_BILL;
    return [
      { label: 'New customer', balance: 0 },
      { label: 'At their credit window', balance: window },
      { label: 'Carrying extra (legacy) debt', balance: window * 2 },
    ].map((row) => ({
      ...row,
      required: requiredForBalance(row.balance, N, floor, ceiling),
    }));
  }, [allowedCreditDeliveries, minExposureFloor, maxOutstandingCeiling]);

  const onSubmit = (data: CashCollectionPolicyInput) => update(data);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          Cash Customers
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Give Cash customers a temporary, proportional credit allowance instead of a fixed
          limit. Customers may carry roughly &ldquo;Allowed Credit Deliveries&rdquo; worth of tab;
          once above it, each visit automatically asks for a bit more than the day&apos;s bill
          until the balance settles back down — no separate recovery rule to configure.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="flex items-center justify-between rounded-xl border border-border/50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Enable Cash Collection Policy</p>
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
                  label="Enable Cash Collection Policy"
                  onToggle={() => field.onChange(!field.value)}
                />
              )}
            />
          </div>

          <div className={cn('grid gap-6 sm:grid-cols-3 transition-opacity', !enabled && 'opacity-60')}>
            <div className="space-y-2">
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                Allowed Credit Deliveries
              </Label>
              <Input
                type="number"
                min={0}
                max={10}
                step="1"
                disabled={!enabled}
                className="bg-accent/30 border-border/50 h-11 font-mono font-bold"
                {...register('allowedCreditDeliveries', { valueAsNumber: true })}
              />
              {errors.allowedCreditDeliveries && (
                <p className="text-xs font-medium text-destructive">
                  {errors.allowedCreditDeliveries.message}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                0 = cash on delivery. 2 = customers may carry about two deliveries&apos; worth of tab.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5 text-muted-foreground" />
                Minimum Amount (₨)
              </Label>
              <Input
                type="number"
                min={0}
                step="1"
                disabled={!enabled}
                className="bg-accent/30 border-border/50 h-11 font-mono font-bold"
                {...register('minExposureFloor', { valueAsNumber: true })}
              />
              {errors.minExposureFloor && (
                <p className="text-xs font-medium text-destructive">{errors.minExposureFloor.message}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Deliveries are never blocked while the total owed is at or below this.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
                Absolute Limit (₨)
              </Label>
              <Controller
                name="maxOutstandingCeiling"
                control={control}
                render={({ field }) => (
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    placeholder="None"
                    disabled={!enabled}
                    className="bg-accent/30 border-border/50 h-11 font-mono font-bold"
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                  />
                )}
              />
              {errors.maxOutstandingCeiling && (
                <p className="text-xs font-medium text-destructive">
                  {errors.maxOutstandingCeiling.message}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Hard maximum any customer may owe, regardless of size. Leave empty for none.
              </p>
            </div>
          </div>

          {/* Live worked example (§4.4-A/B mini-example, pure display arithmetic) */}
          <div className={cn('rounded-xl border border-border/50 overflow-hidden transition-opacity', !enabled && 'opacity-60')}>
            <div className="px-4 py-2.5 bg-accent/20 border-b border-border/50 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground">
                Example — for a ₨{EXAMPLE_BILL} delivery
              </p>
            </div>
            <div className="divide-y divide-border/50">
              {exampleRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div>
                    <p className="font-medium">{row.label}</p>
                    <p className="text-[11px] text-muted-foreground">Currently owes ₨{row.balance.toLocaleString()}</p>
                  </div>
                  <p className={cn('font-mono font-bold', row.required > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                    {row.required > 0 ? `Collect ₨${row.required.toLocaleString()}` : 'No payment required'}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Rollout-guard impact hint (§8.1, §21.1 — mandatory for Phase 2) */}
          <div className={cn('rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 transition-opacity', !enabled && 'opacity-60')}>
            {impactLoading ? (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking impact on your current customers…
              </p>
            ) : impact ? (
              <p className="text-xs text-muted-foreground">
                With these settings, <span className="font-bold text-foreground">{impact.wouldOwePayment}</span> of
                your {impact.totalActiveCashCustomers} active Cash customers would owe a payment on their next
                delivery
                {impact.wouldOweOverThreshold > 0 && (
                  <>
                    ; <span className="font-bold text-foreground">{impact.wouldOweOverThreshold}</span> of them more
                    than ₨1,000
                  </>
                )}
                .
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Enter valid settings above to preview the impact on your current Cash customers.
              </p>
            )}
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
