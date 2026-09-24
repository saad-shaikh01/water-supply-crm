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
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@water-supply-crm/ui';
import { CalendarCheck, Loader2, Plus, Settings2 } from 'lucide-react';
import type { AttendanceStatus } from '@water-supply-crm/types';
import { useAttendanceCategories, useMarkAttendance } from '../hooks/use-attendance';
import { ManageAttendanceCategoriesDialog } from './manage-attendance-categories-dialog';

// Sentinel <SelectItem> value that opens the "add a category" dialog instead
// of selecting anything — mirrors ServiceRecordFormDialog's ADD_NEW_TYPE.
const ADD_NEW_CATEGORY = '__add_new_category__';

const STATUS_OPTIONS: Array<{ value: AttendanceStatus; label: string }> = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'ABSENT', label: 'Absent (unpaid)' },
  { value: 'HALF_DAY', label: 'Half day (unpaid)' },
  { value: 'LEAVE', label: 'Leave' },
  { value: 'WEEKLY_OFF', label: 'Weekly off' },
];

/** Statuses that accept an optional explicit deduction amount (mirrors the server DTO rule). */
const AMOUNT_ELIGIBLE = new Set<AttendanceStatus>(['ABSENT', 'HALF_DAY']);

export interface MarkAttendanceTarget {
  userId: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  /** Current status for that cell, if any — used to prefill the Select. */
  currentStatus?: AttendanceStatus;
  /** Current category id, if the existing row is a categorized PRESENT marking. */
  currentCategoryId?: string;
  /**
   * `baseAmount ÷ period day count` for a MONTHLY employee — prefills (never
   * forces) the deduction amount for an ABSENT/HALF_DAY marking, so a manager
   * doesn't have to guess a number by hand. Still fully editable/clearable —
   * leaving it blank still means no deduction, exactly as before.
   */
  suggestedAmount?: number | null;
}

interface MarkAttendanceDialogProps {
  /** Non-null ⇒ dialog open (SettlementDialog / SalaryStructureDialog convention). */
  target: MarkAttendanceTarget | null;
  onOpenChange: (open: boolean) => void;
}

export function MarkAttendanceDialog({ target, onOpenChange }: MarkAttendanceDialogProps) {
  const { mutate: mark, isPending } = useMarkAttendance();
  const { data: categories, isLoading: categoriesLoading } = useAttendanceCategories(!!target);
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);

  const [status, setStatus] = useState<AttendanceStatus | undefined>(undefined);
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [note, setNote] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!target) return;
    setStatus(target.currentStatus);
    setAmount(target.suggestedAmount ?? undefined);
    setNote('');
    setCategoryId(target.currentCategoryId);
    // Re-sync only when a different cell opens, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.userId, target?.date]);

  const amountEligible = !!status && AMOUNT_ELIGIBLE.has(status);
  // A manual PRESENT marking is the exception path — the employee wasn't on
  // their usual route/crew that day, so a category explaining why is required
  // (mirrors the server's CATEGORIZED_ATTENDANCE_STATUSES rule).
  const categoryRequired = status === 'PRESENT';
  const isValid = !!target && !!status && (!categoryRequired || !!categoryId);

  const handleSubmit = () => {
    if (!isValid || !target || !status) return;
    mark(
      {
        userId: target.userId,
        date: target.date,
        status,
        amount: amountEligible && amount && amount > 0 ? amount : undefined,
        note: note.trim() || undefined,
        categoryId: categoryRequired ? categoryId : undefined,
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

          {categoryRequired && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                  Category <span className="text-destructive">*</span>
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                  onClick={() => setManageCategoriesOpen(true)}
                >
                  <Settings2 className="h-3 w-3" />
                  Manage
                </Button>
              </div>
              <Select
                value={categoryId}
                onValueChange={(v) => (v === ADD_NEW_CATEGORY ? setManageCategoriesOpen(true) : setCategoryId(v))}
                disabled={categoriesLoading}
              >
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Why was this a manual Present?" />
                </SelectTrigger>
                <SelectContent>
                  {(categories ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                  <SelectSeparator />
                  <SelectItem value={ADD_NEW_CATEGORY} className="text-primary font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> Add new category…
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                E.g. an employee who wasn&apos;t on their route but was doing some other office task. Lets you filter
                present days by reason later.
              </p>
            </div>
          )}

          {amountEligible && (
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Deduction amount (₨) — optional
              </Label>
              <Input
                type="number"
                min={1}
                step={1}
                placeholder="Leave blank — admin adjusts at payroll"
                value={amount ?? ''}
                onChange={(e) =>
                  setAmount(e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)))
                }
                className="h-12 text-xl font-black font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                {target?.suggestedAmount
                  ? `Suggested: base salary ÷ days in period = ₨${target.suggestedAmount.toLocaleString()} — edit or clear it. `
                  : ''}
                Only if you want to post a LEAVE_UNPAID entry to this employee&apos;s payroll ledger right now.
                Otherwise this day is just recorded — the admin decides deductions when payroll is built.
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

      <ManageAttendanceCategoriesDialog
        open={manageCategoriesOpen}
        onOpenChange={setManageCategoriesOpen}
        // Newly added category is what the admin wanted to record — select it.
        onCreated={(created) => setCategoryId(created.id)}
        onDeleted={(removed) => {
          if (categoryId === removed.id) setCategoryId(undefined);
        }}
      />
    </Dialog>
  );
}
