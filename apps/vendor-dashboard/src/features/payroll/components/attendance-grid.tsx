'use client';

import { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  Skeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { AlertCircle, Inbox } from 'lucide-react';
import type { AttendanceStatus } from '@water-supply-crm/types';
import { usePermissions } from '../../authz/hooks/use-permissions';
import { useOpenPayrollPeriod } from '../hooks/use-payroll-dashboard';
import { usePayrollPeriods } from '../hooks/use-payroll-history';
import { useEligibleEmployees } from '../hooks/use-eligible-employees';
import { useAttendanceByPeriod } from '../hooks/use-attendance';
import type { AttendanceRecord } from '../api/payroll.api';
import { MarkAttendanceDialog, type MarkAttendanceTarget } from './mark-attendance-dialog';

const STATUS_META: Record<AttendanceStatus, { code: string; label: string; className: string }> = {
  PRESENT: { code: 'P', label: 'Present', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  ABSENT: { code: 'A', label: 'Absent', className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  HALF_DAY: { code: 'H', label: 'Half day', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  LEAVE: { code: 'L', label: 'Leave', className: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  WEEKLY_OFF: { code: 'O', label: 'Weekly off', className: 'bg-muted text-muted-foreground' },
};

const STATUS_ORDER = Object.keys(STATUS_META) as AttendanceStatus[];

/** Inclusive list of YYYY-MM-DD strings between two ISO datetimes, UTC-day stepped. */
function eachUtcDay(startIso: string, endIso: string): string[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  let cur = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const days: string[] = [];
  // Guard against a malformed range producing an unbounded loop.
  while (cur <= last && days.length < 400) {
    days.push(new Date(cur).toISOString().slice(0, 10));
    cur += 86_400_000;
  }
  return days;
}

function weekdayLabel(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
}

function permissionCard(message: string) {
  return (
    <Card className="bg-muted/30 border-border/40">
      <CardContent className="p-4 text-sm text-muted-foreground flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        {message}
      </CardContent>
    </Card>
  );
}

function errorCard(message: string) {
  return (
    <Card className="bg-destructive/5 border-destructive/20">
      <CardContent className="p-4 text-sm text-destructive">{message}</CardContent>
    </Card>
  );
}

export function AttendanceGrid() {
  const { can } = usePermissions();
  const canView = can('payroll:attendance_view');
  const canMark = can('payroll:attendance_mark');
  // The current period is resolved via find-or-create, which needs period_generate;
  // browsing prior periods needs view_all. Manager (the default attendance holder)
  // has the former. Fall back gracefully when a permission is missing.
  const canResolveCurrent = can('payroll:period_generate');
  const canBrowseHistory = can('payroll:view_all');

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | undefined>(undefined);
  const [markTarget, setMarkTarget] = useState<MarkAttendanceTarget | null>(null);

  const {
    data: openPeriod,
    isLoading: openLoading,
    isError: openError,
  } = useOpenPayrollPeriod(canView && canResolveCurrent);
  const { data: periods } = usePayrollPeriods(canView && canBrowseHistory);

  const activePeriodId = selectedPeriodId ?? openPeriod?.id;

  const period = useMemo(() => {
    if (!activePeriodId) return undefined;
    return periods?.find((p) => p.id === activePeriodId) ?? (openPeriod?.id === activePeriodId ? openPeriod : undefined);
  }, [periods, openPeriod, activePeriodId]);

  const { data: employees, isLoading: empLoading, isError: empError } = useEligibleEmployees();
  const {
    data: records,
    isLoading: recLoading,
    isError: recError,
  } = useAttendanceByPeriod(activePeriodId, canView);

  const byKey = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of records ?? []) map.set(`${r.userId}|${r.date.slice(0, 10)}`, r);
    return map;
  }, [records]);

  if (!canView) {
    return permissionCard('Attendance requires additional payroll permissions.');
  }
  if (!canResolveCurrent && !selectedPeriodId) {
    return permissionCard('Viewing attendance requires the payroll period-generate permission.');
  }

  if (openLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (openError && !period) {
    return errorCard('Failed to load the payroll period.');
  }
  if (!period) {
    return errorCard('No payroll period is available yet.');
  }

  const days = eachUtcDay(period.startDate, period.endDate);
  const periodOptions = periods && periods.length > 0 ? periods : openPeriod ? [openPeriod] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={activePeriodId} onValueChange={(v) => setSelectedPeriodId(v)}>
          <SelectTrigger className="h-10 w-56">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {periodOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.periodLabel}
                {p.id === openPeriod?.id ? ' (current)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {STATUS_ORDER.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className={cn(
                  'inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold',
                  STATUS_META[s].className,
                )}
              >
                {STATUS_META[s].code}
              </span>
              {STATUS_META[s].label}
            </span>
          ))}
        </div>
      </div>

      {empError || recError ? (
        errorCard('Failed to load attendance.')
      ) : empLoading || recLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !employees?.length ? (
        <div className="rounded-2xl border border-border bg-white/[0.02] p-10 text-center">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-bold text-muted-foreground/60">No payroll-eligible employees found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40">
                <th className="sticky left-0 z-10 min-w-[10rem] bg-muted/40 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Employee
                </th>
                {days.map((d) => (
                  <th
                    key={d}
                    className="whitespace-nowrap px-1.5 py-2 text-center text-[10px] font-bold text-muted-foreground"
                  >
                    {d.slice(8, 10)}
                    <span className="block text-[9px] font-normal opacity-60">{weekdayLabel(d)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-t border-border/50">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-background px-3 py-2 font-semibold">
                    {emp.name}
                  </td>
                  {days.map((d) => {
                    const rec = byKey.get(`${emp.id}|${d}`);
                    const meta = rec ? STATUS_META[rec.status] : null;
                    return (
                      <td key={d} className="px-1 py-1 text-center">
                        <button
                          type="button"
                          disabled={!canMark}
                          onClick={() =>
                            canMark &&
                            setMarkTarget({ userId: emp.id, name: emp.name, date: d, currentStatus: rec?.status })
                          }
                          title={
                            rec
                              ? `${meta?.label}${rec.note ? ` — ${rec.note}` : ''}`
                              : canMark
                                ? 'Mark attendance'
                                : ''
                          }
                          className={cn(
                            'inline-flex h-7 w-7 items-center justify-center rounded text-xs font-bold transition',
                            meta ? meta.className : 'text-muted-foreground/30',
                            canMark ? 'cursor-pointer hover:ring-2 hover:ring-primary/40' : 'cursor-default',
                          )}
                        >
                          {meta ? meta.code : '·'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canMark && (
        <MarkAttendanceDialog target={markTarget} onOpenChange={(o) => !o && setMarkTarget(null)} />
      )}
    </div>
  );
}
