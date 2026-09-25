'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, Skeleton,
  Tabs, TabsList, TabsTrigger, TabsContent,
  Button, Input,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { Receipt, HandCoins, CheckCircle2, XCircle, Plus, Ban, AlertTriangle, Loader2 } from 'lucide-react';
import { StatusBadge } from '../../../components/shared/status-badge';
import { ledgerCategoryLabel } from '../constants';
import { useEntryBreakdown, useApproveEntry, type PayrollEntryBucketTotals, type AttendanceBreakdownDay } from '../hooks/use-monthly-payroll';
import { useCollectAdvanceInstallment, useSkipAdvanceInstallment } from '../hooks/use-advance-plans';
import { useAttendanceCategories } from '../hooks/use-attendance';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { MarkAttendanceDialog, type MarkAttendanceTarget } from './mark-attendance-dialog';
import { STATUS_META } from './attendance-grid';
import { NewAdvancePlanDialog } from './new-advance-plan-dialog';
import { WriteOffAdvancePlanDialog } from './write-off-advance-plan-dialog';
import { LogLedgerEntryDialog } from './log-ledger-entry-dialog';
import type { StaffAdvancePlanWithPeriodInstallment, AttendanceStatus } from '@water-supply-crm/types';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';

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

/** Inclusive list of YYYY-MM-DD strings between two ISO datetimes, UTC-day stepped — mirrors `attendance-grid.tsx`'s own helper. */
function eachUtcDay(startIso: string, endIso: string): string[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  let cur = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const days: string[] = [];
  while (cur <= last && days.length < 400) {
    days.push(new Date(cur).toISOString().slice(0, 10));
    cur += 86_400_000;
  }
  return days;
}

/** Sunday-first weeks, leading/trailing cells padded with `null` so the grid stays a clean 7-column shape. */
function buildCalendarWeeks(days: string[]): Array<string | null>[] {
  if (days.length === 0) return [];
  const firstWeekday = new Date(`${days[0]}T00:00:00Z`).getUTCDay();
  const cells: Array<string | null> = [...Array(firstWeekday).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<string | null>[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const STATUS_FILTER_ALL = '__all__';
const CATEGORY_FILTER_ALL = '__all__';

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
  const { data, isLoading, isError, refetch } = useEntryBreakdown(entryId ?? undefined);
  const { can } = usePermissions();
  const canMarkAttendance = can('payroll:attendance_mark');
  const canManageAdvancePlans = can('payroll:advance_plan_manage');
  const canLogEntry = can('payroll:ledger_create');
  const canApprove = can('payroll:entry_approve');
  const { mutate: approveEntry, isPending: isApproving } = useApproveEntry(data?.entry.periodId);

  const [tab, setTab] = useState('breakdown');
  const [markTarget, setMarkTarget] = useState<MarkAttendanceTarget | null>(null);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [addAdjustmentOpen, setAddAdjustmentOpen] = useState(false);
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [writeOffPlanTarget, setWriteOffPlanTarget] = useState<StaffAdvancePlanWithPeriodInstallment | null>(null);
  const [collectAmount, setCollectAmount] = useState<number | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string>(STATUS_FILTER_ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(CATEGORY_FILTER_ALL);

  const { data: categories } = useAttendanceCategories(tab === 'attendance');

  const collect = useCollectAdvanceInstallment(entryId ?? '', data?.entry.userId ?? '');
  const skip = useSkipAdvanceInstallment(entryId ?? '', data?.entry.userId ?? '');

  const periodWritable = data ? !['LOCKED', 'PAID'].includes(data.entry.period.status) : false;

  // Honest freshness check, no new endpoint: `entry[key]` is the STORED bucket total
  // (last set by Generate Draft or Lock); `ledgerEntriesByBucket[key]` is a LIVE query
  // the same `getBreakdown` call already returns. If they disagree, something posted
  // after the entry was last computed — the total above is not yet current.
  const hasUnreflectedLedgerChanges =
    !!data &&
    BUCKET_ORDER.some(
      ({ key }) => data.ledgerEntriesByBucket[key].reduce((sum, e) => sum + e.amount, 0) !== data.entry[key],
    );

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
              <div className="flex items-center gap-2">
                <StatusBadge status={data.entry.status} />
                {canApprove && data.entry.status === 'DRAFT' && (
                  <Button
                    size="sm"
                    className="rounded-lg h-7 text-xs font-bold"
                    disabled={isApproving}
                    onClick={() =>
                      approveEntry({ id: data.entry.id, version: data.entry.version }, { onSuccess: () => refetch() })
                    }
                  >
                    {isApproving ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
                    Approve
                  </Button>
                )}
              </div>
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
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Ledger Entries by Bucket
                    </h3>
                    {canLogEntry && periodWritable && (
                      <Button
                        size="sm" variant="outline"
                        className="rounded-lg h-7 text-xs font-bold gap-1.5"
                        onClick={() => setAddAdjustmentOpen(true)}
                      >
                        <Plus className="h-3.5 w-3.5" /> Add Adjustment
                      </Button>
                    )}
                  </div>
                  {hasUnreflectedLedgerChanges && (
                    <p className="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        The totals above don't yet include a recent change.{' '}
                        {data.entry.status === 'DRAFT'
                          ? 'Regenerate the draft from Monthly Payroll to include it.'
                          : 'It will be included automatically when this period is locked.'}
                      </span>
                    </p>
                  )}
                  {data.cashWindow && (
                    <p className="text-xs text-muted-foreground bg-accent/30 border border-border/40 rounded-lg px-3 py-2">
                      {data.cashWindow.categories.map((c) => ledgerCategoryLabel(c)).join(', ')} use a separate
                      cash-deduction window: {formatDate(data.cashWindow.startDate)} – {formatDate(data.cashWindow.endDate)}.
                      Every other category uses the attendance period above.
                    </p>
                  )}
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

                {/* Filters — status narrows which days are highlighted; category narrows PRESENT days by reason. */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant={statusFilter === STATUS_FILTER_ALL ? 'default' : 'outline'}
                      className="h-7 rounded-lg text-xs font-bold px-2.5"
                      onClick={() => setStatusFilter(STATUS_FILTER_ALL)}
                    >
                      All
                    </Button>
                    {(Object.keys(STATUS_META) as AttendanceStatus[]).map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant={statusFilter === s ? 'default' : 'outline'}
                        className="h-7 rounded-lg text-xs font-bold px-2.5"
                        onClick={() => setStatusFilter(s)}
                      >
                        {STATUS_META[s].label}
                      </Button>
                    ))}
                  </div>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-7 w-40 text-xs ml-auto">
                      <SelectValue placeholder="Any category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CATEGORY_FILTER_ALL}>Any category</SelectItem>
                      {(categories ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Calendar */}
                {(() => {
                  const daysByDate = new Map(data.attendance.days.map((d) => [ymd(d.date), d]));
                  const allPeriodDays = eachUtcDay(data.entry.period.startDate, data.entry.period.endDate);
                  const weeks = buildCalendarWeeks(allPeriodDays);
                  return (
                    <div className="space-y-1">
                      <div className="grid grid-cols-7 gap-1">
                        {WEEKDAY_LABELS.map((w) => (
                          <div key={w} className="text-center text-[10px] font-bold text-muted-foreground">{w}</div>
                        ))}
                      </div>
                      {weeks.map((week, wi) => (
                        <div key={wi} className="grid grid-cols-7 gap-1">
                          {week.map((date, di) => {
                            if (!date) return <div key={di} />;
                            const day = daysByDate.get(date);
                            const meta = day ? STATUS_META[day.status] : null;
                            const matchesStatus = statusFilter === STATUS_FILTER_ALL || day?.status === statusFilter;
                            const matchesCategory = categoryFilter === CATEGORY_FILTER_ALL || day?.categoryId === categoryFilter;
                            const dimmed = !matchesStatus || !matchesCategory;
                            const deductible = !!day && DEDUCTIBLE_STATUSES.has(day.status);
                            const canDeduct = deductible && !day?.hasDeduction && canMarkAttendance && periodWritable;
                            return (
                              <button
                                key={date}
                                type="button"
                                disabled={!canDeduct}
                                onClick={() => day && canDeduct && openDeduct(day)}
                                title={
                                  day
                                    ? `${formatDate(date)} — ${ATTENDANCE_STATUS_LABEL[day.status] ?? day.status}${day.categoryName ? ` (${day.categoryName})` : ''}`
                                    : `${formatDate(date)} — no record`
                                }
                                className={cn(
                                  'relative rounded-lg h-11 flex items-center justify-center text-[11px] font-bold transition-opacity',
                                  meta ? meta.className : 'bg-muted/20 text-muted-foreground',
                                  dimmed && 'opacity-25',
                                  canDeduct && 'cursor-pointer hover:ring-2 hover:ring-primary/40',
                                  !canDeduct && 'cursor-default',
                                )}
                              >
                                {Number(date.slice(8, 10))}
                                {day?.hasDeduction && (
                                  <CheckCircle2 className="h-3 w-3 absolute bottom-0.5 right-0.5 text-emerald-600" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                <p className="text-[10px] text-muted-foreground">
                  Click an Absent/Half Day cell to deduct — a green check means it already has a deduction.
                </p>
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
                          <div className="text-right shrink-0 flex items-start gap-1.5">
                            <div>
                              <p className="font-mono font-black text-amber-500">₨ {plan.remainingBalance.toLocaleString()}</p>
                              <p className="text-[10px] text-muted-foreground">remaining</p>
                            </div>
                            {canManageAdvancePlans && plan.remainingBalance > 0 && (
                              <Button
                                variant="ghost" size="icon"
                                className="h-6 w-6 text-destructive hover:text-destructive"
                                title="Write off remaining balance"
                                onClick={() => setWriteOffPlanTarget(plan)}
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </Button>
                            )}
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
      <WriteOffAdvancePlanDialog
        plan={writeOffPlanTarget}
        employeeId={data?.entry.userId ?? ''}
        entryId={entryId ?? undefined}
        onOpenChange={(o) => !o && setWriteOffPlanTarget(null)}
      />
      <LogLedgerEntryDialog
        open={addAdjustmentOpen}
        onOpenChange={setAddAdjustmentOpen}
        employee={data ? { id: data.entry.userId, name: data.entry.user.name } : null}
        onSuccess={() => refetch()}
      />
    </Dialog>
  );
}
