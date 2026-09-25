'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Label, Skeleton, cn } from '@water-supply-crm/ui';
import { CalendarClock, Wallet, AlertCircle } from 'lucide-react';
import type { StaffLedgerCategory } from '@water-supply-crm/types';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { usePayrollVendorConfig, useUpdatePayrollVendorConfig } from '../hooks/use-payroll-config';
import { ledgerCategoryLabel } from '../constants';

/**
 * Every category eligible for the cash-deduction window — everything except
 * ADVANCE_DISBURSEMENT, which never enters a PayrollEntry bucket at all
 * (mirrors `CASH_WINDOW_ELIGIBLE_CATEGORIES` in the backend DTO).
 */
const CASH_WINDOW_ELIGIBLE_CATEGORIES: StaffLedgerCategory[] = [
  'ADVANCE',
  'ADVANCE_RECOVERY',
  'EXPENSE_REIMBURSEMENT',
  'BONUS',
  'INCENTIVE',
  'OVERTIME',
  'PENALTY',
  'DEDUCTION',
  'LEAVE_UNPAID',
  'LEAVE_PAID',
  'ADJUSTMENT',
  'CREW_CASH',
  'REVERSAL',
  'CORRECTION',
];

/**
 * Vendor-wide Payroll settings (Dual-Cutoff Payroll Flexibility,
 * owner-requested 2026-09-25) — lets a vendor run the attendance/wage period
 * on one cutoff day while advances, crew cash, or any other chosen ledger
 * category is cut off on a SEPARATE day. Handles e.g. a vendor whose
 * attendance period is calendar-month but whose advance/crew-cash
 * deductions are collected up to the 10th, ahead of a 10th-of-next-month
 * salary release. Gated on `payroll:config_manage` (VENDOR_ADMIN-only by
 * default — see the RBAC amendment note).
 */
export function PayrollSettings() {
  const { can } = usePermissions();
  const canManage = can('payroll:config_manage');

  const { data: config, isLoading, isError } = usePayrollVendorConfig(canManage);
  const { mutate: save, isPending } = useUpdatePayrollVendorConfig();

  const [cutoffDay, setCutoffDay] = useState(1);
  const [cashWindowEnabled, setCashWindowEnabled] = useState(false);
  const [cashCutoffDay, setCashCutoffDay] = useState(10);
  const [cashWindowCategories, setCashWindowCategories] = useState<StaffLedgerCategory[]>([]);

  useEffect(() => {
    if (!config) return;
    setCutoffDay(config.cutoffDay);
    setCashWindowEnabled(config.cashCutoffDay != null);
    setCashCutoffDay(config.cashCutoffDay ?? 10);
    setCashWindowCategories(config.cashWindowCategories);
  }, [config]);

  if (!canManage) {
    return (
      <Card className="bg-muted/30 border-border/40">
        <CardContent className="p-4 text-sm text-muted-foreground flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Managing payroll settings requires additional permissions.
        </CardContent>
      </Card>
    );
  }

  if (isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (isError || !config) {
    return (
      <Card className="bg-destructive/5 border-destructive/20">
        <CardContent className="p-4 text-sm text-destructive">Failed to load payroll settings.</CardContent>
      </Card>
    );
  }

  const toggleCategory = (category: StaffLedgerCategory) => {
    setCashWindowCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    );
  };

  const onSave = () => {
    save({
      cutoffDay,
      cashCutoffDay: cashWindowEnabled ? cashCutoffDay : null,
      cashWindowCategories: cashWindowEnabled ? cashWindowCategories : [],
    });
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            Attendance / Wage Period
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            The day of the month the payroll period starts and ends. Attendance, base salary, and
            every ledger category NOT redirected below are computed against this period.
          </p>
        </CardHeader>
        <CardContent className="space-y-2 max-w-xs">
          <Label className="text-sm font-semibold">Period start day</Label>
          <Input
            type="number"
            min={1}
            max={28}
            className="bg-accent/30 border-border/50 h-11 font-mono font-bold"
            value={cutoffDay}
            onChange={(e) => setCutoffDay(Number(e.target.value))}
          />
          <p className="text-[11px] text-muted-foreground">
            1 = plain calendar month (1st–last day). 10 = a 10th-to-9th cycle, and so on.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            Cash-Deduction Window (Optional)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            For a business that keeps attendance/wages on a calendar-month period but settles
            advances, crew cash (meal, etc.), or other selected categories on a DIFFERENT cutoff —
            e.g. attendance runs 1st–31st, but advance/crew-cash deductions cut off on the 10th
            ahead of a 10th-of-next-month salary release. Leave off if one single period works for
            every category (the default for every vendor).
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-xl border border-border/50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Use a separate cash-deduction window</p>
              <p className="text-xs text-muted-foreground">
                When off, every category uses the attendance period above — nothing changes.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={cashWindowEnabled}
              aria-label="Use a separate cash-deduction window"
              onClick={() => setCashWindowEnabled((v) => !v)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                cashWindowEnabled ? 'bg-emerald-500' : 'bg-input dark:bg-muted',
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform',
                  cashWindowEnabled ? 'translate-x-5' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>

          <div className={cn('space-y-5 transition-opacity', !cashWindowEnabled && 'opacity-50 pointer-events-none')}>
            <div className="space-y-2 max-w-xs">
              <Label className="text-sm font-semibold">Cash-window start day</Label>
              <Input
                type="number"
                min={1}
                max={28}
                className="bg-accent/30 border-border/50 h-11 font-mono font-bold"
                value={cashCutoffDay}
                onChange={(e) => setCashCutoffDay(Number(e.target.value))}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Categories using the cash window</Label>
              <p className="text-[11px] text-muted-foreground">
                Everything left unchecked stays on the attendance period above.
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CASH_WINDOW_ELIGIBLE_CATEGORIES.map((category) => (
                  <label
                    key={category}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors',
                      cashWindowCategories.includes(category)
                        ? 'bg-primary/10 border-primary/40'
                        : 'bg-background border-border/40 hover:border-primary/30',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="rounded accent-primary h-4 w-4"
                      checked={cashWindowCategories.includes(category)}
                      onChange={() => toggleCategory(category)}
                    />
                    {ledgerCategoryLabel(category)}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={isPending} className="min-w-[140px] shadow-lg shadow-primary/20">
          {isPending ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}
