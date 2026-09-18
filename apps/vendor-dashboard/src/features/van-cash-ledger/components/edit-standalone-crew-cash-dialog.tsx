'use client';

import { useEffect, useId, useState } from 'react';
import { Lock, PencilLine } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import type { CrewCashCategory } from '@water-supply-crm/types';
import { pktToday } from '../../../lib/date-pkt';
import { useEligibleEmployees } from '../../payroll/hooks/use-eligible-employees';
import { CREW_CASH_CATEGORIES, CREW_CASH_CATEGORY_CONFIG } from '../../crew-cash/constants';
import { useUpdateStandaloneCrewCash } from '../../crew-cash/hooks/use-crew-cash';
import type { UpdateStandaloneCrewCashData } from '../../crew-cash/api/crew-cash.api';
import type { CashLedgerRow } from '../api/van-cash-ledger.api';
import { fmtDate, money, pktDayKey } from '../format';
import { DialogDiffPreview, type DiffPreviewItem } from './dialog-diff-preview';

interface EditStandaloneCrewCashDialogProps {
  row: CashLedgerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Offered in the "locked" state — hands off to the void-and-re-record flow. */
  onRequestVoid?: () => void;
}

const MIN_REASON = 5;
const NOTES_MAX = 500;

const asCategory = (c: string | undefined | null): CrewCashCategory | '' =>
  c && (CREW_CASH_CATEGORIES as string[]).includes(c) ? (c as CrewCashCategory) : '';

/**
 * Edits a standalone (no Daily Sheet) crew-cash entry in place. Only the
 * changed fields are sent with the row's `version` and a mandatory audit
 * reason. When the linked payroll entry is locked (`canEdit === false`) the
 * form is replaced by a "void and re-record" explanation.
 */
export function EditStandaloneCrewCashDialog({
  row, open, onOpenChange, onRequestVoid,
}: EditStandaloneCrewCashDialogProps) {
  const { data: employees, isLoading: employeesLoading } = useEligibleEmployees();
  const updateCrewCash = useUpdateStandaloneCrewCash();
  const reasonHelpId = useId();

  const [employeeId, setEmployeeId] = useState('');
  const [category, setCategory] = useState<CrewCashCategory | ''>('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open && row) {
      setEmployeeId(row.employeeId ?? '');
      setCategory(asCategory(row.category));
      setAmount(String(Math.trunc(row.displayAmount ?? 0)));
      setDate(pktDayKey(row.date));
      setNotes(row.notes ?? '');
      setReason('');
    }
  }, [open, row]);

  if (!row) return null;

  // ── Locked state: the payroll twin is already in a locked period ──
  if (!row.canEdit) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="rounded-3xl max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <Lock className="h-5 w-5 text-amber-500" />
              Can&apos;t edit this entry
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-500 px-3 py-3 text-sm">
              <Lock className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
              <p>
                {row.editBlockedReason ?? 'This entry can no longer be edited.'}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              To correct it, void this entry and record it again with the right details. The voided row stays
              visible for the audit trail.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="min-h-11">Close</Button>
            {onRequestVoid ? (
              <Button
                variant="destructive"
                onClick={() => {
                  onOpenChange(false);
                  onRequestVoid();
                }}
                className="rounded-xl font-bold min-h-11"
              >
                Void this entry instead
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Editable form ──
  const origEmployeeId = row.employeeId ?? '';
  const origCategory = asCategory(row.category);
  const origAmount = Math.trunc(row.displayAmount ?? 0);
  const origDate = pktDayKey(row.date);
  const origNotes = (row.notes ?? '').trim();

  const today = pktToday();
  const parsedAmount = Number(amount);
  const amountValid = amount !== '' && Number.isInteger(parsedAmount) && parsedAmount >= 1;
  const dateValid = !!date && date <= today;
  const trimmedNotes = notes.trim();

  const employeeChanged = !!employeeId && employeeId !== origEmployeeId;
  const categoryChanged = !!category && category !== origCategory;
  const amountChanged = amountValid && parsedAmount !== origAmount;
  const dateChanged = dateValid && date !== origDate;
  const notesChanged = trimmedNotes !== origNotes;

  const anyChanged = employeeChanged || categoryChanged || amountChanged || dateChanged || notesChanged;
  const reasonValid = reason.trim().length >= MIN_REASON;
  const formValid = !!employeeId && !!category && amountValid && dateValid;
  const canSubmit = formValid && anyChanged && reasonValid && !updateCrewCash.isPending;

  const employeeName = (id: string): string => {
    if (!id) return '—';
    return employees?.find((e) => e.id === id)?.name ?? (id === row.employeeId ? row.employeeName : null) ?? 'Unknown employee';
  };
  const categoryLabel = (c: CrewCashCategory | ''): string => (c ? CREW_CASH_CATEGORY_CONFIG[c].label : '—');

  const diff: DiffPreviewItem[] = [
    { label: 'Employee', before: employeeName(origEmployeeId), after: employeeName(employeeId || origEmployeeId) },
    { label: 'Category', before: categoryLabel(origCategory), after: categoryLabel(category || origCategory) },
    { label: 'Amount', before: money(origAmount), after: amountValid ? money(parsedAmount) : money(origAmount) },
    { label: 'Date', before: fmtDate(origDate), after: dateValid ? fmtDate(date) : fmtDate(origDate) },
    { label: 'Notes', before: origNotes || '—', after: trimmedNotes || '—' },
  ];

  const handleSubmit = () => {
    if (!canSubmit || !row.sourceRecordId) return;
    const payload: UpdateStandaloneCrewCashData = { version: row.version ?? 1, reason: reason.trim() };
    if (employeeChanged) payload.employeeId = employeeId;
    if (categoryChanged && category) payload.category = category;
    if (amountChanged) payload.amount = parsedAmount;
    if (dateChanged) payload.date = date;
    if (notesChanged) payload.notes = trimmedNotes;

    updateCrewCash.mutate(
      { id: row.sourceRecordId, data: payload },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <PencilLine className="h-5 w-5 text-primary" />
            Edit Crew Cash
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Employee <span className="text-destructive">*</span>
            </Label>
            <Select value={employeeId} onValueChange={setEmployeeId} disabled={employeesLoading}>
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue placeholder={employeesLoading ? 'Loading employees…' : 'Select employee'} />
              </SelectTrigger>
              <SelectContent>
                {row.employeeId && !(employees ?? []).some((e) => e.id === row.employeeId) ? (
                  <SelectItem value={row.employeeId}>{row.employeeName ?? 'Current employee'}</SelectItem>
                ) : null}
                {(employees ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                    <span className="ml-1 text-xs text-muted-foreground">({e.role.toLowerCase()})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Category <span className="text-destructive">*</span>
            </Label>
            <Select value={category} onValueChange={(v) => setCategory(v as CrewCashCategory)}>
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CREW_CASH_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>{CREW_CASH_CATEGORY_CONFIG[cat].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-crew-cash-amount" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Amount (₨) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-crew-cash-amount"
              type="number"
              min={1}
              step={1}
              placeholder="0"
              value={amount}
              onChange={(e) =>
                setAmount(e.target.value === '' ? '' : String(Math.trunc(Number(e.target.value))))
              }
              className="h-12 rounded-xl text-xl font-black font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-crew-cash-date" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Date <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-crew-cash-date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 rounded-xl"
            />
            {date && date > today ? (
              <p className="text-xs text-destructive">Date can&apos;t be in the future.</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-crew-cash-notes" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Notes
            </Label>
            <Input
              id="edit-crew-cash-notes"
              placeholder="Optional notes..."
              value={notes}
              maxLength={NOTES_MAX}
              onChange={(e) => setNotes(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>

          <DialogDiffPreview changes={diff} />

          <p className="text-xs text-muted-foreground">
            Editing re-posts the linked payroll entry for the employee; the old one is voided.
          </p>

          <div className="space-y-2">
            <Label htmlFor="edit-crew-cash-reason" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason for change <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="edit-crew-cash-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-describedby={reasonHelpId}
              aria-required
              maxLength={500}
              className="rounded-xl min-h-20"
              placeholder="e.g. Paid to the wrong person"
            />
            <p id={reasonHelpId} className="text-xs text-muted-foreground">
              Why are you changing this? Kept in the audit trail (at least {MIN_REASON} characters).
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="min-h-11">Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-xl font-bold min-h-11"
          >
            {updateCrewCash.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
