'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, Skeleton,
  Tabs, TabsList, TabsTrigger, TabsContent,
  Badge, Button, Input,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { Receipt, CalendarDays, HandCoins, CheckCircle2, XCircle, Plus } from 'lucide-react';
import { StatusBadge } from '../../../components/shared/status-badge';
import { ledgerCategoryLabel } from '../constants';
import { useEntryBreakdown, type PayrollEntryBucketTotals, type AttendanceBreakdownDay } from '../hooks/use-monthly-payroll';
import { useCollectAdvanceInstallment, useSkipAdvanceInstallment } from '../hooks/use-advance-plans';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { MarkAttendanceDialog, type MarkAttendanceTarget } from './mark-attendance-dialog';
import { NewAdvancePlanDialog } from './new-advance-plan-dialog';

interface EntryBreakdownDialogProps {
  entryId: string | null;
  onOpenChange: (open: boolean) => void;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function ymd(d: string) {
  return d.slice(0, 10);
}

const BUCKET_ORDER: Array<{ key: keyof PayrollEntryBucketTotals; label: string }> = [
  { key: 'bonuses', label: 'Bonuses' },
  { key: 'overtime', label: 'Overtime' },
  { key: 'incentives', label: 'Incentives' },
  { key: 'advances', label: 'Advances' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'penalties', label: 'Penalties' },
  { key: 'otherDeductions', label: 'Other Deductions' },
];

const ATTENDANCE_STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  HALF_DAY: 'Half Day',
  LEAVE: 'Leave',
  WEEKLY_OFF: 'Weekly Off',
};

/** Statuses eligible for an inline "Deduct" action — mirrors `MarkAttendanceDialog`'s `AMOUNT_ELIGIBLE`. */
const DEDUCTIBLE_STATUSES = new Set(['ABSENT', 'HALF_DAY']);

/**
 * Row-click detail — this codebase's established "DataTable has no
 * renderExpanded — use a Dialog" convention (mirrors
 * `sheet-crew-cash-section.tsx`'s edit-on-row-click pattern).
 *
 * Three tabs (owner-requested 2026-09-24): Breakdown (original), Attendance
 * (history for this employee/period + an inline "Deduct" action per
 * absent/half-day, MONTHLY employees get a suggested amount instead of a
 * blank field), Advances (this employee's active advance plans + this
 * period's due installment, Collect/Skip right here).
 */
export function EntryBreakdownDialog({ entryId, onOpenChange }: EntryBreakdownDialogProps) {
  const { data, isLoading, isError } = useEntryBreakdown(entryId ?? undefined);
  const { can } = usePermissions();
  const canMarkAttendance = can('payroll:attendance_mark');
  const canManageAdvancePlans = can('payroll:advance_plan_manage');

  const [tab, setTab] = useState('breakdown');
  const [markTarget, setMarkTarget] = useState<MarkAttendanceTarget | null>(null);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [collectAmount, setCollectAmount] = useState<number | undefined>(undefined);

  const collect = useCollectAdvanceInstallment(entryId ?? '', data?.entry.userId ?? '');
  const skip = useSkipAdvanceInstallment(entryId ?? '', data?.entry.userId ?? '');

  const periodWritable = data ? !['LOCKED', 'PAID'].includes(data.entry.period.status) : false;

  const handleClose = (open: boolean) => {
    if (open) return;
    setTab('breakdown');
    setCollectingId(null);
    onOpenChange(false);
  };

  const openDeduct = (day: AttendanceBreakdownDay) => {
    if (!data) return;
    setMarkTarget({
      userId: data.entry.userId,
      name: data.entry.user.name,
      date: ymd(day.date),
      currentStatus: day.status,
      suggestedAmount: data.suggestedMonthlyDailyRate ?? undefined,
    });
  };

  const startCollect = (installmentId: string, scheduledAmount: number) => {
    setCollectingId(installmentId);
    setCollectAmount(scheduledAmount);
  };

  return (
    <Dialog open={!!entryId} onOpenChange={handleClose}>
      <DialogContent className="rounded-3xl max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            Payroll Entry Detail
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : isError || !data ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center text-sm text-destructive">
            Failed to load this entry's breakdown.
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-lg font-bold">{data.entry.user.name}</p>
                <p className="text-xs text-muted-foreground">{data.entry.period.periodLabel}</p>
              </div>
              <StatusBadge status={data.entry.status} />
            </div>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid h-10 w-full grid-cols-3">
                <TabsTrigger value="breakdown" className="text-xs font-bold">Breakdown</TabsTrigger>
                <TabsTrigger value="attendance" className="text-xs font-bold">Attendance</TabsTrigger>
                <TabsTrigger value="advances" className="text-xs font-bold">Advances</TabsTrigger>
              </TabsList>

              {/* ── Breakdown ─────────────────────────────────────────────── */}
              <TabsContent value="breakdown" className="space-y-5 mt-4">
                <div className="rounded-2xl border border-border/50 bg-muted/20 divide-y divide-border/50">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm font-semibold text-muted-foreground">Base Salary</span>
                    <span className="font-mono font-bold">₨ {data.entry.baseSalary.toLocaleString()}</span>
                  </div>
                  {BUCKET_ORDER.map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm font-semibold text-muted-foreground">{label}</span>
                      <span
                        className={cn(
                          'font-mono font-bold',
                          data.entry[key] > 0 ? 'text-emerald-500' : data.entry[key] < 0 ? 'text-destructive' : 'text-foreground',
                        )}
                      >
                        {data.entry[key] >= 0 ? '+' : '−'}₨ {Math.abs(data.entry[key]).toLocaleString()}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm font-semibold text-muted-foreground">Carry Forward In</span>
                    <span
                      className={cn(
                        'font-mono font-bold',
                        data.entry.carryForwardIn > 0 ? 'text-emerald-500' : data.entry.carryForwardIn < 0 ? 'text-destructive' : 'text-foreground',
                      )}
                    >
                      {data.entry.carryForwardIn >= 0 ? '+' : '−'}₨ {Math.abs(data.entry.carryForwardIn).toLocaleString()}
                    </span>
                  </div>
                  <div
                    className={cn(
                      'flex items-center justify-between px-4 py-3.5 rounded-b-2xl',
                      data.entry.finalPayable < 0 ? 'bg-destructive/10' : 'bg-primary/5',
                    )}
                  >
                    <span className="text-sm font-black uppercase tracking-widest">Final Payable</span>
                    <span className={cn('font-mono font-black text-lg', data.entry.finalPayable < 0 ? 'text-destructive' : 'text-foreground')}>
                      ₨ {data.entry.finalPayable.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Ledger Entries by Bucket
                  </h3>
                  {BUCKET_ORDER.every(({ key }) => data.ledgerEntriesByBucket[key].length === 0) ? (
                    <p className="text-sm text-muted-foreground">No ledger entries fed this breakdown.</p>
                  ) : (
                    BUCKET_ORDER.filter(({ key }) => data.ledgerEntriesByBucket[key].length > 0).map(({ key, label }) => (
                      <div key={key} className="space-y-1.5">
                        <p className="text-xs font-bold text-muted-foreground">{label}</p>
                        <div className="rounded-xl border border-border/40 divide-y divide-border/40 overflow-hidden">
                          {data.ledgerEntriesByBucket[key].map((entry) => (
                            <div key={entry.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                              <div className="min-w-0">
                                <span className="font-semibold">{ledgerCategoryLabel(entry.category)}</span>
                                <span className="text-xs text-muted-foreground ml-2">{formatDate(entry.effectiveDate)}</span>
                                {entry.description && (
                                  <p className="text-xs text-muted-foreground truncate">{entry.description}</p>
                                )}
                              </div>
                              <span className={cn('font-mono font-bold shrink-0', entry.amount >= 0 ? 'text-emerald-500' : 'text-destructive')}>
                                {entry.amount >= 0 ? '+' : '−'}₨ {Math.abs(entry.amount).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              {/* ── Attendance ────────────────────────────────────────────── */}
              <TabsContent value="attendance" className="space-y-4 mt-4">
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {[
                    { label: 'Present', value: data.attendance.presentDays, tone: 'text-emerald-500' },
                    { label: 'Absent', value: data.attendance.absentDays, tone: 'text-destructive' },
                    { label: 'Half Day', value: data.attendance.halfDays, tone: 'text-amber-500' },
                    { label: 'Leave', value: data.attendance.leaveDays, tone: 'text-foreground' },
                    { label: 'Weekly Off', value: data.attendance.weeklyOffDays, tone: 'text-muted-foreground' },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-border/40 bg-muted/20 p-2.5 text-center">
                      <p className={cn('text-lg font-black font-mono', s.tone)}>{s.value}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>
                {data.attendance.unmarkedDays > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {data.attendance.unmarkedDays} of {data.attendance.periodDayCount} day
                    {data.attendance.periodDayCount === 1 ? '' : 's'} in this period {data.attendance.unmarkedDays === 1 ? 'has' : 'have'} no attendance record.
                  </p>
                )}

                {data.attendance.days.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No attendance recorded for this period yet.</p>
                ) : (
                  <div className="rounded-xl border border-border/40 divide-y divide-border/40 overflow-hidden">
                    {data.attendance.days.map((day) => {
                      const deductible = DEDUCTIBLE_STATUSES.has(day.status);
                      return (
                        <div key={day.date} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="font-semibold">{formatDate(day.date)}</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {ATTENDANCE_STATUS_LABEL[day.status] ?? day.status}
                            </Badge>
                            {day.categoryName && <span className="text-xs text-muted-foreground truncate">{day.categoryName}</span>}
                          </div>
                          {deductible && (
                            day.hasDeduction ? (
                              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-500 shrink-0">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Deducted
                              </span>
                            ) : canMarkAttendance && periodWritable ? (
                              <Button
                                size="sm" variant="outline"
                                className="h-7 rounded-lg text-xs font-bold shrink-0"
                                onClick={() => openDeduct(day)}
                              >
                                Deduct
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground shrink-0">Not deducted</span>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              {/* ── Advances ──────────────────────────────────────────────── */}
              <TabsContent value="advances" className="space-y-4 mt-4">
                {canManageAdvancePlans && (
                  <Button
                    size="sm" variant="outline"
                    className="rounded-lg h-8 text-xs font-bold gap-1.5"
                    onClick={() => setNewPlanOpen(true)}
                  >
                    <Plus className="h-3.5 w-3.5" /> New Advance Plan
                  </Button>
                )}

                {data.advancePlans.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active advance plans for this employee.</p>
                ) : (
                  <div className="space-y-3">
                    {data.advancePlans.map((plan) => (
                      <div key={plan.id} className="rounded-2xl border border-border/40 p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-mono font-bold">₨ {plan.principalAmount.toLocaleString()} plan</p>
                            <p className="text-[11px] text-muted-foreground">
                              Disbursed {formatDate(plan.disbursedAt)} · ₨ {plan.defaultInstallmentAmount.toLocaleString()}/period default
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono font-black text-amber-500">₨ {plan.remainingBalance.toLocaleString()}</p>
                            <p className="text-[10px] text-muted-foreground">remaining</p>
                          </div>
                        </div>

                        {!plan.installment ? (
                          <p className="text-xs text-muted-foreground">No installment generated for this period yet — regenerate the draft.</p>
                        ) : plan.installment.status === 'COLLECTED' ? (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-500">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Collected ₨ {(plan.installment.actualAmount ?? 0).toLocaleString()} this period
                          </div>
                        ) : plan.installment.status === 'SKIPPED' ? (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                            <XCircle className="h-3.5 w-3.5" />
                            Skipped this period — balance rolled forward
                          </div>
                        ) : !canManageAdvancePlans || !periodWritable ? (
                          <p className="text-xs text-muted-foreground">
                            Due this period: ₨ {plan.installment.scheduledAmount.toLocaleString()}
                          </p>
                        ) : collectingId === plan.installment.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number" min={1} step={1}
                              value={collectAmount ?? ''}
                              onChange={(e) => setCollectAmount(e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)))}
                              className="h-8 w-32 font-mono font-bold"
                            />
                            <Button
                              size="sm"
                              className="h-8 rounded-lg text-xs font-bold"
                              disabled={collect.isPending || !collectAmount || collectAmount <= 0}
                              onClick={() => {
                                if (!plan.installment || !collectAmount) return;
                                collect.mutate(
                                  { id: plan.installment.id, data: { amount: collectAmount } },
                                  { onSuccess: () => setCollectingId(null) },
                                );
                              }}
                            >
                              Confirm
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 rounded-lg text-xs" onClick={() => setCollectingId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground mr-auto">
                              Due: ₨ {plan.installment.scheduledAmount.toLocaleString()}
                            </span>
                            <Button
                              size="sm" variant="outline"
                              className="h-8 rounded-lg text-xs font-bold gap-1.5"
                              onClick={() => startCollect(plan.installment!.id, plan.installment!.scheduledAmount)}
                            >
                              <HandCoins className="h-3.5 w-3.5" /> Collect
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              className="h-8 rounded-lg text-xs font-bold"
                              disabled={skip.isPending}
                              onClick={() => plan.installment && skip.mutate(plan.installment.id)}
                            >
                              Skip
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>

      <MarkAttendanceDialog target={markTarget} onOpenChange={(o) => !o && setMarkTarget(null)} />
      <NewAdvancePlanDialog
        employee={newPlanOpen && data ? { id: data.entry.userId, name: data.entry.user.name } : null}
        onOpenChange={setNewPlanOpen}
        entryId={entryId ?? undefined}
      />
    </Dialog>
  );
}
