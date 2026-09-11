'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@water-supply-crm/ui';
import { CalendarCheck, Loader2 } from 'lucide-react';
import type { AttendanceStatus } from '@water-supply-crm/types';
import { useMarkAttendance } from '../hooks/use-attendance';

const STATUS_OPTIONS: Array<{ value: AttendanceStatus; label: string }> = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'ABSENT', label: 'Absent (unpaid)' },
  { value: 'HALF_DAY', label: 'Half day (unpaid)' },
  { value: 'LEAVE', label: 'Leave' },
  { value: 'WEEKLY_OFF', label: 'Weekly off' },
];

/** Statuses that require an explicit deduction amount (mirrors the server DTO rule). */
const AMOUNT_REQUIRED = new Set<AttendanceStatus>(['ABSENT', 'HALF_DAY']);

export interface MarkAttendanceTarget {
  userId: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  /** Current status for that cell, if any — used to prefill the Select. */
  currentStatus?: AttendanceStatus;
}

interface MarkAttendanceDialogProps {
  /** Non-null ⇒ dialog open (SettlementDialog / SalaryStructureDialog convention). */
  target: MarkAttendanceTarget | null;
  onOpenChange: (open: boolean) => void;
}

export function MarkAttendanceDialog({ target, onOpenChange }: MarkAttendanceDialogProps) {
  const { mutate: mark, isPending } = useMarkAttendance();

  const [status, setStatus] = useState<AttendanceStatus | undefined>(undefined);
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!target) return;
    setStatus(target.currentStatus);
    setAmount(undefined);
    setNote('');
    // Re-sync only when a different cell opens, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.userId, target?.date]);

  const amountRequired = !!status && AMOUNT_REQUIRED.has(status);
  const isValid = !!target && !!status && (!amountRequired || (!!amount && amount > 0));

  const handleSubmit = () => {
    if (!isValid || !target || !status) return;
    mark(
      {
        userId: target.userId,
        date: target.date,
        status,
        amount: amountRequired ? amount : undefined,
        note: note.trim() || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !isPending && !o && onOpenChange(false)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-primary" />
            Mark Attendance
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Employee</Label>
            <div className="h-10 px-3 flex items-center rounded-xl border border-border/50 bg-muted/40 text-sm font-semibold">
              {target?.name} — {target?.date}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Status <span className="text-destructive">*</span>
            </Label>
            <Select value={status} onValueChange={(v) => setStatus(v as AttendanceStatus)}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {amountRequired && (
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Deduction amount (₨) <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={1}
                step={1}
                placeholder="0"
                value={amount ?? ''}
                onChange={(e) =>
                  setAmount(e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)))
                }
                className="h-12 text-xl font-black font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Posts a LEAVE_UNPAID entry to this employee&apos;s payroll ledger for {target?.date}.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Note</Label>
            <Input placeholder="Optional note..." value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !isValid}
            className="rounded-xl font-bold gap-2"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
