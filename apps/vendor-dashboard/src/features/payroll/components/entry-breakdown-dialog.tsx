'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, Skeleton,
  Tabs, TabsList, TabsTrigger, TabsContent,
  Button, Input,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { Receipt, HandCoins, CheckCircle2, XCircle, Plus, Ban, AlertTriangle, Loader2, Trash2, Undo2, CalendarClock, BadgeCheck } from 'lucide-react';
import { AdjustLockedEntryDialog } from './adjust-locked-entry-dialog';
import { useAuthStore } from '../../../store/auth.store';
import { VoidLedgerEntryDialog } from './void-ledger-entry-dialog';
import { StatusBadge } from '../../../components/shared/status-badge';
import { ledgerCategoryLabel } from '../constants';
import { useEntryBreakdown, useApproveEntry, useRecalculateEntry, PENDING_ABSENCE_DECISIONS_CODE, type PayrollEntryBucketTotals, type BreakdownLedgerEntry } from '../hooks/use-monthly-payroll';
import { useCollectAdvanceInstallment, useSkipAdvanceInstallment } from '../hooks/use-advance-plans';
import { useAttendanceCategories } from '../hooks/use-attendance';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { AbsenceDecisionBar } from './absence-decision-bar';
import { ApproveEntryConfirmDialog } from './approve-entry-confirm-dialog';
import { DeferLedgerEntryDialog } from './defer-ledger-entry-dialog';
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

/** Statuses a paid/unpaid decision applies to. */
const DEDUCTIBLE_STATUSES = new Set(['ABSENT', 'HALF_DAY']);

/** Categories that are bookkeeping fixes themselves / never reach a payroll bucket - never "deduct next month". */
const NOT_DEFERRABLE_CATEGORIES = new Set(['REVERSAL', 'CORRECTION', 'ADVANCE_DISBURSEMENT']);

/** Calendar-cell look per decision, layered on top of the status colour. */
const DECISION_LABEL: Record<'DEDUCTED' | 'WAIVED' | 'PENDING', string> = {
  DEDUCTED: 'Unpaid - deducted',
  WAIVED: 'Paid - no deduction',
  PENDING: 'Not decided yet',
};

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
  const { mutate: recalculateEntry, isPending: isRecalculating } = useRecalculateEntry(data?.entry.periodId);
  const canDefer = can('payroll:ledger_void');

  const [tab, setTab] = useState('breakdown');
  // Days ticked in the Attendance calendar for a bulk paid/unpaid decision (YYYY-MM-DD).
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [deferTarget, setDeferTarget] = useState<BreakdownLedgerEntry | null>(null);
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

  // Mirrors StaffLedgerService.voidEntryTx: permission holder OR the creator, and only
  // while the row isn't rolled into a locked period. The server re-checks all of it.
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [voidTarget, setVoidTarget] = useState<BreakdownLedgerEntry | null>(null);
  // Locked-period rows can't be voided — reverse/correct posts a new entry in the open period.
  // Linked penalties and system-owned rows are excluded (their other half would desync);
  // REVERSAL/CORRECTION rows are themselves the fix, not something to fix again.
  const canReverse = can('payroll:ledger_reverse');
  const canCorrect = can('payroll:ledger_correct');
  const [fixTarget, setFixTarget] = useState<BreakdownLedgerEntry | null>(null);
  const canFixLocked = (e: BreakdownLedgerEntry) =>
    e.payrollEntryId !== null &&
    !e.alreadyReversed &&
    !e.managedElsewhere &&
    !e.causedCustomerAdjustmentId &&
    e.category !== 'REVERSAL' &&
    e.category !== 'CORRECTION' &&
    (canReverse || canCorrect);
  const canVoidEntry = (e: BreakdownLedgerEntry) =>
    periodWritable && e.payrollEntryId === null && (can('payroll:ledger_void') || e.createdById === currentUserId);
  // "Deduct next month" needs the same authority as a void (the server enforces payroll:ledger_void) and only
  // makes sense for a deduction nobody else owns; the server re-checks every one of these.
  const canDeferEntry = (e: BreakdownLedgerEntry) =>
    canDefer &&
    periodWritable &&
    e.payrollEntryId === null &&
    (e.amount < 0 || !!e.payrollAttributionDate) &&
    !NOT_DEFERRABLE_CATEGORIES.has(e.category) &&
    !e.managedElsewhere;

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
    setSelectedDates(new Set());
    setApproveConfirmOpen(false);
    onOpenChange(false);
  };

  const toggleDate = (date: string) =>
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  // Approve: a soft confirm when there is something the admin should knowingly accept (undecided absences, a
  // negative payable). The server enforces the absence part too, so a stale screen cannot sneak past it.
  const pendingAbsenceDays = data?.attendance.pendingDecisionDays ?? 0;
  const approveNow = (acknowledge: boolean) => {
    if (!data) return;
    approveEntry(
      { id: data.entry.id, version: data.entry.version, acknowledgePendingAbsences: acknowledge },
      {
        onSuccess: () => {
          setApproveConfirmOpen(false);
          refetch();
        },
        onError: (e: any) => {
          if (e?.response?.data?.code === PENDING_ABSENCE_DECISIONS_CODE) setApproveConfirmOpen(true);
        },
      },
    );
  };
  const handleApproveClick = () => {
    if (!data) return;
    if (pendingAbsenceDays > 0 || data.entry.finalPayable < 0) setApproveConfirmOpen(true);
    else approveNow(false);
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
                    onClick={handleApproveClick}
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
                  {data.entry.deferredIn > 0 && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm font-semibold text-muted-foreground">Held back last period, charged now</span>
                      <span className="font-mono font-bold text-destructive">−₨ {data.entry.deferredIn.toLocaleString()}</span>
                    </div>
                  )}
                  {data.entry.deferredOut > 0 && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm font-semibold text-muted-foreground">Held back (over max-deduction limit)</span>
                      <span className="font-mono font-bold text-emerald-500">+₨ {data.entry.deferredOut.toLocaleString()}</span>
                    </div>
                  )}
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

                {data.entry.finalPayable < 0 && (
                  <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      Deductions are <strong>₨ {Math.abs(data.entry.finalPayable).toLocaleString()} more than the salary</strong>.
                      The employee would owe this amount, which carries forward to the next period. To avoid this, defer some
                      deductions to next month or waive them below
                      {canDefer ? '' : ' (needs the ledger void permission)'}.
                    </span>
                  </div>
                )}
                {(data.entry.deferredOut > 0 || data.entry.deferredIn > 0) && (
                  <div className="text-xs text-amber-700 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      The maximum-deduction limit is on (Payroll Settings).
                      {data.entry.deferredOut > 0 &&
                        ` ₨ ${data.entry.deferredOut.toLocaleString()} of this month's deductions is held back and will be charged next period.`}
                      {data.entry.deferredIn > 0 &&
                        ` ₨ ${data.entry.deferredIn.toLocaleString()} held back last period is charged now.`}
                    </span>
                  </div>
                )}

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
                    <div className="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-2">
                        <span>
                          This entry is <strong>{data.entry.status}</strong> — a ledger entry was posted after that,
                          so the totals above don't include it yet.{' '}
                          {data.entry.status === 'DRAFT' &&
                            'Regenerate the draft from Monthly Payroll to include it.'}
                          {(data.entry.status === 'APPROVED' || data.entry.status === 'UNDER_REVIEW') &&
                            !canApprove &&
                            'It will be included automatically when this period is locked, or ask someone who can approve entries to recalculate it now.'}
                        </span>
                        {(data.entry.status === 'APPROVED' || data.entry.status === 'UNDER_REVIEW') && canApprove && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-lg h-7 text-xs font-bold gap-1.5 border-amber-500/40 text-amber-700 hover:text-amber-800"
                            disabled={isRecalculating}
                            onClick={() =>
                              recalculateEntry(
                                { id: data.entry.id, version: data.entry.version },
                                { onSuccess: () => refetch() },
                              )
                            }
                          >
                            {isRecalculating ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                            Recalculate Now
                          </Button>
                        )}
                      </div>
                    </div>
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
                                {entry.payrollAttributionDate && (
                                  <span
                                    className="ml-2 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary"
                                    title="Moved here from an earlier month with Deduct next month"
                                  >
                                    <CalendarClock className="h-2.5 w-2.5" /> deferred to here
                                  </span>
                                )}
                                {entry.description && (
                                  <p className="text-xs text-muted-foreground truncate">{entry.description}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className={cn('font-mono font-bold', entry.amount >= 0 ? 'text-emerald-500' : 'text-destructive')}>
                                  {entry.amount >= 0 ? '+' : '−'}₨ {Math.abs(entry.amount).toLocaleString()}
                                </span>
                                {entry.managedElsewhere ? (
                                  <span
                                    className="text-[10px] text-muted-foreground"
                                    title={`Created by ${entry.managedElsewhere} — undo it from there`}
                                  >
                                    via {entry.managedElsewhere}
                                  </span>
                                ) : canVoidEntry(entry) ? (
                                  <>
                                    {canDeferEntry(entry) && (
                                      <Button
                                        variant="ghost" size="icon"
                                        className="h-6 w-6 text-primary hover:text-primary"
                                        title={entry.payrollAttributionDate ? 'Undo "Deduct next month"' : 'Deduct next month instead'}
                                        onClick={() => setDeferTarget(entry)}
                                      >
                                        <CalendarClock className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost" size="icon"
                                      className="h-6 w-6 text-destructive hover:text-destructive"
                                      title="Waive - void this entry so it is not deducted at all"
                                      onClick={() => setVoidTarget(entry)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                ) : entry.alreadyReversed ? (
                                  <span className="text-[10px] text-muted-foreground">reversed</span>
                                ) : canFixLocked(entry) ? (
                                  <Button
                                    variant="ghost" size="icon"
                                    className="h-6 w-6 text-primary hover:text-primary"
                                    title="Reverse or correct (locked period)"
                                    onClick={() => setFixTarget(entry)}
                                  >
                                    <Undo2 className="h-3.5 w-3.5" />
                                  </Button>
                                ) : null}
                              </div>
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
                {data.attendance.decisionsApply && (
                  <div
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-xs flex flex-wrap items-center gap-x-3 gap-y-2',
                      data.attendance.pendingDecisionDays > 0
                        ? 'border-amber-500/30 bg-amber-500/5'
                        : 'border-border/40 bg-muted/20',
                    )}
                  >
                    {data.attendance.pendingDecisionDays > 0 ? (
                      <span className="font-semibold text-amber-700">
                        {data.attendance.pendingDecisionDays} absent / half-day day
                        {data.attendance.pendingDecisionDays === 1 ? '' : 's'} not decided yet — approving pays{' '}
                        {data.attendance.pendingDecisionDays === 1 ? 'it' : 'them'} in full.
                      </span>
                    ) : (
                      <span className="font-semibold text-muted-foreground">Every absent / half-day day has a paid / unpaid decision.</span>
                    )}
                    {canMarkAttendance && periodWritable && !['LOCKED', 'SETTLED'].includes(data.entry.status) && (
                      <span className="flex flex-wrap items-center gap-1.5 ml-auto">
                        {data.attendance.pendingDecisionDays > 0 && (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 rounded-lg text-xs font-bold"
                            onClick={() =>
                              setSelectedDates(
                                new Set(data.attendance.days.filter((d) => d.decision === 'PENDING').map((d) => ymd(d.date))),
                              )
                            }
                          >
                            Select all undecided ({data.attendance.pendingDecisionDays})
                          </Button>
                        )}
                        {selectedDates.size > 0 && (
                          <Button size="sm" variant="ghost" className="h-7 rounded-lg text-xs" onClick={() => setSelectedDates(new Set())}>
                            Clear
                          </Button>
                        )}
                      </span>
                    )}
                  </div>
                )}
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
                            // Only a MONTHLY employee's Absent / Half-day days carry a paid/unpaid decision.
                            const decidable =
                              !!day && data.attendance.decisionsApply && DEDUCTIBLE_STATUSES.has(day.status) && day.decision !== null;
                            const canSelect =
                              decidable && canMarkAttendance && periodWritable && !['LOCKED', 'SETTLED'].includes(data.entry.status);
                            const selected = selectedDates.has(date);
                            return (
                              <button
                                key={date}
                                type="button"
                                disabled={!canSelect}
                                aria-pressed={canSelect ? selected : undefined}
                                onClick={() => canSelect && toggleDate(date)}
                                title={
                                  day
                                    ? `${formatDate(date)} — ${ATTENDANCE_STATUS_LABEL[day.status] ?? day.status}${day.categoryName ? ` (${day.categoryName})` : ''}${day.decision ? ` — ${DECISION_LABEL[day.decision]}${day.waivedReason ? `: ${day.waivedReason}` : ''}` : ''}`
                                    : `${formatDate(date)} — no record`
                                }
                                className={cn(
                                  'relative rounded-lg h-11 flex items-center justify-center text-[11px] font-bold transition-opacity',
                                  meta ? meta.className : 'bg-muted/20 text-muted-foreground',
                                  dimmed && 'opacity-25',
                                  canSelect && 'cursor-pointer hover:ring-2 hover:ring-primary/40',
                                  !canSelect && 'cursor-default',
                                  day?.decision === 'PENDING' && 'ring-1 ring-amber-500/60',
                                  selected && 'ring-2 ring-primary',
                                )}
                              >
                                {Number(date.slice(8, 10))}
                                {day?.decision === 'DEDUCTED' && (
                                  <CheckCircle2 className="h-3 w-3 absolute bottom-0.5 right-0.5 text-emerald-600" />
                                )}
                                {day?.decision === 'WAIVED' && (
                                  <BadgeCheck className="h-3 w-3 absolute bottom-0.5 right-0.5 text-sky-500" />
                                )}
                                {day?.decision === 'PENDING' && (
                                  <span className="absolute top-0.5 right-1 text-[10px] font-black text-amber-500">?</span>
                                )}
                                {selected && (
                                  <span className="absolute top-0.5 left-1 h-2 w-2 rounded-full bg-primary" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {data.attendance.decisionsApply && (
                  <>
                    <AbsenceDecisionBar
                      userId={data.entry.userId}
                      selected={data.attendance.days.filter((d) => selectedDates.has(ymd(d.date)))}
                      suggestedRate={data.suggestedMonthlyDailyRate}
                      onClear={() => setSelectedDates(new Set())}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Tick the Absent / Half Day cells, then choose <strong>Unpaid</strong> (deduct) or <strong>Paid</strong> (no deduction) for all of
                      them at once. <span className="text-amber-500 font-bold">?</span> = not decided ·{' '}
                      <CheckCircle2 className="inline h-3 w-3 text-emerald-600" /> = unpaid, deducted ·{' '}
                      <BadgeCheck className="inline h-3 w-3 text-sky-500" /> = paid, no deduction.
                    </p>
                  </>
                )}
                {!data.attendance.decisionsApply && (
                  <p className="text-[10px] text-muted-foreground">
                    This employee is paid per attended day, so an absence is already unpaid — nothing to decide here.
                  </p>
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
      <VoidLedgerEntryDialog entry={voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)} />
      <DeferLedgerEntryDialog
        entry={deferTarget}
        periodId={data?.entry.periodId ?? ''}
        periodLabel={data?.entry.period.periodLabel ?? ''}
        onOpenChange={(o) => !o && setDeferTarget(null)}
      />
      <ApproveEntryConfirmDialog
        open={approveConfirmOpen}
        onOpenChange={setApproveConfirmOpen}
        employeeName={data?.entry.user.name ?? ''}
        pendingAbsenceDays={pendingAbsenceDays}
        finalPayable={data?.entry.finalPayable ?? 0}
        deferredOut={data?.entry.deferredOut ?? 0}
        isLoading={isApproving}
        onConfirm={() => approveNow(true)}
      />
      <AdjustLockedEntryDialog
        entry={fixTarget}
        onOpenChange={(o) => !o && setFixTarget(null)}
        canReverse={canReverse}
        canCorrect={canCorrect}
      />
      <LogLedgerEntryDialog
        open={addAdjustmentOpen}
        onOpenChange={setAddAdjustmentOpen}
        employee={data ? { id: data.entry.userId, name: data.entry.user.name } : null}
        onSuccess={() => refetch()}
        disableCustomerLink
      />
    </Dialog>
  );
}
