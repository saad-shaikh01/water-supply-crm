'use client';

import { useState } from 'react';
import { Button, Input, Label, cn } from '@water-supply-crm/ui';
import { BadgeCheck, CircleDollarSign, Loader2, RotateCcw, X } from 'lucide-react';
import type { AttendanceBreakdownDay } from '../hooks/use-monthly-payroll';
import { useResolveAbsences } from '../hooks/use-absence-decisions';

interface AbsenceDecisionBarProps {
  userId: string;
  /** The days the admin ticked in the calendar - all Absent / Half-day (the calendar only lets those be ticked). */
  selected: AttendanceBreakdownDay[];
  /** `baseAmount / period days` for a MONTHLY employee - pre-fills the rate, never forced. */
  suggestedRate: number | null;
  onClear: () => void;
}

/** Mirrors the server: a half-day is charged half the daily rate, rounded to a whole rupee. */
export function halfDayAmount(dailyRate: number): number {
  return Math.round(dailyRate / 2);
}

/**
 * Deduction the server will post for these days at `dailyRate`. Days that already carry a live deduction are
 * skipped by the server (idempotent), so they are not counted here either.
 */
export function previewDeduction(days: AttendanceBreakdownDay[], dailyRate: number): { total: number; absent: number; half: number } {
  let absent = 0;
  let half = 0;
  for (const d of days) {
    if (d.decision === 'DEDUCTED') continue;
    if (d.status === 'HALF_DAY') half++;
    else if (d.status === 'ABSENT') absent++;
  }
  return { total: absent * dailyRate + half * halfDayAmount(dailyRate), absent, half };
}

/**
 * Action bar under the Attendance calendar: decide ALL ticked Absent / Half-day days in one go - unpaid
 * (deduct), paid (waive, no deduction) or reset. Server-side the batch is all-or-nothing.
 */
export function AbsenceDecisionBar({ userId, selected, suggestedRate, onClear }: AbsenceDecisionBarProps) {
  const resolve = useResolveAbsences();
  const [rate, setRate] = useState<number | undefined>(suggestedRate ?? undefined);
  const [note, setNote] = useState('');

  if (selected.length === 0) return null;

  const dates = selected.map((d) => d.date.slice(0, 10));
  const counts = {
    pending: selected.filter((d) => d.decision === 'PENDING').length,
    waived: selected.filter((d) => d.decision === 'WAIVED').length,
    deducted: selected.filter((d) => d.decision === 'DEDUCTED').length,
  };
  const validRate = rate != null && Number.isInteger(rate) && rate > 0;
  const preview = validRate ? previewDeduction(selected, rate) : null;
  const nothingToDeduct = preview != null && preview.absent + preview.half === 0;
  const hasDeducted = counts.deducted > 0;
  const hasDecided = counts.deducted + counts.waived > 0;
  const busy = resolve.isPending;

  const run = (action: 'UNPAID' | 'WAIVE' | 'RESET') =>
    resolve.mutate(
      {
        userId,
        dates,
        action,
        ...(action === 'UNPAID' ? { dailyRate: rate } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        // The server refreshes this employee's DRAFT payroll entry in the same transaction, and the mutation
        // hook invalidates every payroll query - nothing else to trigger here.
        onSuccess: () => {
          setNote('');
          onClear();
        },
      },
    );

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3.5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-sm font-bold">
            {selected.length} day{selected.length === 1 ? '' : 's'} selected
          </p>
          <p className="text-[11px] text-muted-foreground">
            {[
              counts.pending > 0 && `${counts.pending} undecided`,
              counts.waived > 0 && `${counts.waived} already paid`,
              counts.deducted > 0 && `${counts.deducted} already deducted`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onClear} disabled={busy} title="Clear selection">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Deduction per absent day (₨)</Label>
          <Input
            type="number"
            min={1}
            step={1}
            value={rate ?? ''}
            onChange={(e) => setRate(e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)))}
            className="h-9 font-mono font-bold"
            disabled={busy}
          />
          <p className="text-[10px] text-muted-foreground">
            A half-day is charged half{validRate ? ` (₨ ${halfDayAmount(rate).toLocaleString()})` : ''}.
            {suggestedRate != null && ' Pre-filled: salary ÷ days in the period.'}
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Note (optional)</Label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="e.g. Unauthorised absence / Medical leave"
            className="h-9"
            disabled={busy}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="rounded-lg font-bold gap-1.5"
          disabled={busy || !validRate || nothingToDeduct}
          onClick={() => run('UNPAID')}
          title={nothingToDeduct ? 'Every selected day already has a deduction.' : undefined}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleDollarSign className="h-3.5 w-3.5" />}
          Unpaid — deduct{preview && !nothingToDeduct ? ` ₨ ${preview.total.toLocaleString()}` : ''}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="rounded-lg font-bold gap-1.5 border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/5"
          disabled={busy || hasDeducted}
          onClick={() => run('WAIVE')}
          title={hasDeducted ? 'Some selected days already have a deduction - reset those first.' : 'Paid: no deduction for these days'}
        >
          <BadgeCheck className="h-3.5 w-3.5" /> Paid — no deduction
        </Button>
        {hasDecided && (
          <Button
            size="sm"
            variant="ghost"
            className={cn('rounded-lg font-bold gap-1.5 text-muted-foreground')}
            disabled={busy}
            onClick={() => run('RESET')}
            title="Undo the decision (voids a deduction that is not yet locked) and mark these days undecided again"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to undecided
          </Button>
        )}
      </div>
    </div>
  );
}
