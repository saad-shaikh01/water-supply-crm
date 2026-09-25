'use client';

import { useMemo, useState } from 'react';
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
import { CalendarOff, Loader2 } from 'lucide-react';
import type { AttendanceRecord, MarkAttendanceData } from '../api/payroll.api';
import { useBulkMarkAttendance } from '../hooks/use-attendance';

type OffReason = 'WEEKLY_OFF' | 'OTHER';

interface MarkDayOffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** YYYY-MM-DD options — the days of the currently viewed payroll period. */
  days: string[];
  employees: Array<{ id: string; name: string }>;
  /** Existing records, keyed `${userId}|${date}`. */
  byKey: Map<string, AttendanceRecord>;
}

/** A cell is fair game for a bulk day-off marking unless it's a real Present. */
function isEligibleForDayOff(rec: AttendanceRecord | undefined): boolean {
  return !rec || rec.status === 'ABSENT';
}

/**
 * Marks a whole day off (weekly off / holiday) for every employee whose cell
 * on that day is still empty OR was bulk-marked Absent by mistake (e.g. "Mark
 * Empty as Absent" run on a day that should've been off) — a manually-marked
 * Present, Half day, or Leave cell is never overwritten. There's no dedicated
 * bulk endpoint, so this just fans one `mark` call per eligible cell out
 * through `useBulkMarkAttendance`.
 */
export function MarkDayOffDialog({ open, onOpenChange, days, employees, byKey }: MarkDayOffDialogProps) {
  const { mutate: bulkMark, isPending } = useBulkMarkAttendance();

  const [date, setDate] = useState<string | undefined>(undefined);
  const [reason, setReason] = useState<OffReason>('WEEKLY_OFF');
  const [note, setNote] = useState('');

  const eligibleCount = useMemo(() => {
    if (!date) return 0;
    return employees.filter((e) => isEligibleForDayOff(byKey.get(`${e.id}|${date}`))).length;
  }, [date, employees, byKey]);

  const reset = () => {
    setDate(undefined);
    setReason('WEEKLY_OFF');
    setNote('');
  };

  const handleClose = (o: boolean) => {
    if (!isPending) {
      if (!o) reset();
      onOpenChange(o);
    }
  };

  const isValid = !!date && eligibleCount > 0 && (reason === 'WEEKLY_OFF' || note.trim().length > 0);

  const handleSubmit = () => {
    if (!isValid || !date) return;
    const targets: MarkAttendanceData[] = employees
      .filter((e) => isEligibleForDayOff(byKey.get(`${e.id}|${date}`)))
      .map((e) => ({
        userId: e.id,
        date,
        status: 'WEEKLY_OFF',
        note: reason === 'OTHER' ? note.trim() : undefined,
      }));
    bulkMark(targets, { onSuccess: () => handleClose(false) });
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <CalendarOff className="h-5 w-5 text-primary" />
            Mark Day Off
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Day <span className="text-destructive">*</span>
            </Label>
            <Select value={date} onValueChange={(v) => setDate(v)}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select a day in this period" />
              </SelectTrigger>
              <SelectContent>
                {days.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as OffReason)}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WEEKLY_OFF">Weekly off</SelectItem>
                <SelectItem value="OTHER">Other (holiday, etc.)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {reason === 'OTHER' && (
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Reason note <span className="text-destructive">*</span>
              </Label>
              <Input placeholder="e.g. Eid holiday" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}

          {date && (
            <p className="text-[11px] text-muted-foreground">
              {eligibleCount > 0
                ? `This will mark ${eligibleCount} employee${eligibleCount === 1 ? '' : 's'} off for ${date} — covering empty cells and any already marked Absent. Employees marked Present, Half day, or Leave are left untouched.`
                : 'Every employee is already marked Present, Half day, or Leave for this day — nothing to mark.'}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !isValid} className="rounded-xl font-bold gap-2">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Mark Off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
