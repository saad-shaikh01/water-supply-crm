'use client';

import { useEffect, useId, useState } from 'react';
import { Lock, PencilLine } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { pktToday } from '../../../lib/date-pkt';
import { useAllVans } from '../../vans/hooks/use-vans';
import { useEditManualCashIn } from '../hooks/use-van-cash-ledger';
import type { CashLedgerRow, EditManualCashInPayload, ManualCashInSource } from '../api/van-cash-ledger.api';
import { MANUAL_CASH_IN_SOURCES, manualCashInSourceLabel } from '../constants';
import { fmtDate, money, pktDayKey } from '../format';
import { DialogDiffPreview, type DiffPreviewItem } from './dialog-diff-preview';

interface EditManualCashInDialogProps {
  row: CashLedgerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MIN_REASON = 5;
const NO_VAN = 'none';
const NO_SOURCE = 'none';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Edits a manual cash-in (OPENING_BALANCE row) in place. Only the fields that
 * actually differ are sent, alongside the row's optimistic-concurrency
 * `version` and a mandatory audit reason.
 */
export function EditManualCashInDialog({ row, open, onOpenChange }: EditManualCashInDialogProps) {
  const { data, isLoading: vansLoading } = useAllVans();
  const editCashIn = useEditManualCashIn();
  const reasonHelpId = useId();

  const [vanId, setVanId] = useState(NO_VAN);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [source, setSource] = useState<string>(NO_SOURCE);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open && row) {
      setVanId(row.vanId ?? NO_VAN);
      setAmount(String(row.displayAmount ?? ''));
      setDate(pktDayKey(row.date));
      setNote(row.notes ?? '');
      setSource(row.source ?? NO_SOURCE);
      setReason('');
    }
  }, [open, row]);

  if (!row) return null;

  const vans = data?.data ?? [];
  const plateOf = (id: string | null): string => {
    if (!id) return 'No van (office-wide)';
    return vans.find((v) => v.id === id)?.plateNumber ?? (id === row.vanId ? row.vanPlateNumber : null) ?? 'Unknown van';
  };

  // ── Compare against the original row ──
  const origAmount = round2(Number(row.displayAmount ?? 0));
  const origDate = pktDayKey(row.date);
  const origVan = row.vanId ?? NO_VAN;
  const origNote = row.notes ?? '';
  const origSource = row.source ?? NO_SOURCE;

  const parsedAmount = Number(amount);
  const amountValid = amount !== '' && Number.isFinite(parsedAmount) && parsedAmount >= 0;
  const today = pktToday();
  const dateValid = !!date && date <= today;
  const trimmedNote = note.trim();
  const noteChanged = trimmedNote !== origNote.trim();
  // The note is a required field on creation, so it can't be cleared by an edit.
  const noteValid = !noteChanged || trimmedNote !== '';

  const amountChanged = amountValid && round2(parsedAmount) !== origAmount;
  const dateChanged = dateValid && date !== origDate;
  const vanChanged = vanId !== origVan;
  const sourceChanged = source !== origSource;

  const anyChanged = amountChanged || dateChanged || vanChanged || noteChanged || sourceChanged;
  const reasonValid = reason.trim().length >= MIN_REASON;
  const formValid = amountValid && dateValid && noteValid;
  const canSubmit = formValid && anyChanged && reasonValid && !editCashIn.isPending;

  const sourceName = (s: string) => (s === NO_SOURCE ? '—' : manualCashInSourceLabel(s as ManualCashInSource) ?? s);

  const diff: DiffPreviewItem[] = [
    { label: 'Amount', before: money(origAmount), after: amountValid ? money(parsedAmount) : money(origAmount) },
    { label: 'Date', before: fmtDate(origDate), after: dateValid ? fmtDate(date) : fmtDate(origDate) },
    { label: 'Van', before: plateOf(row.vanId), after: plateOf(vanId === NO_VAN ? null : vanId) },
    { label: 'Source', before: sourceName(origSource), after: sourceName(source) },
    { label: 'Note', before: origNote.trim() || '—', after: noteValid ? trimmedNote || '—' : origNote.trim() || '—' },
  ];

  const handleSubmit = () => {
    if (!canSubmit || !row.sourceRecordId) return;
    const payload: EditManualCashInPayload = { version: row.version ?? 1, reason: reason.trim() };
    if (amountChanged) payload.amount = round2(parsedAmount);
    if (dateChanged) payload.date = date;
    if (vanChanged) payload.vanId = vanId === NO_VAN ? null : vanId;
    if (noteChanged) payload.note = trimmedNote;
    if (sourceChanged) payload.source = source === NO_SOURCE ? null : (source as ManualCashInSource);

    editCashIn.mutate(
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
            Edit Cash In
          </DialogTitle>
        </DialogHeader>

        {!row.canEdit ? (
          <>
            <div className="py-2">
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-500 px-3 py-3 text-sm">
                <Lock className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
                <p>
                  You can&apos;t edit this entry.
                  {row.editBlockedReason ? ` ${row.editBlockedReason}` : ''}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} className="min-h-11">Close</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                  Van (Optional)
                </Label>
                <Select value={vanId} onValueChange={setVanId} disabled={vansLoading}>
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue placeholder={vansLoading ? 'Loading vans…' : 'Select a van'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_VAN}>No van (office-wide)</SelectItem>
                    {row.vanId && !vans.some((v) => v.id === row.vanId) ? (
                      <SelectItem value={row.vanId}>{row.vanPlateNumber ?? 'Current van'}</SelectItem>
                    ) : null}
                    {vans.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.plateNumber}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-cash-in-amount" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                  Amount <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-cash-in-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-11 rounded-xl"
                  placeholder="0.00"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-cash-in-date" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                  Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-cash-in-date"
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
                <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                  Source (Optional)
                </Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue placeholder="Select a source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SOURCE}>— none —</SelectItem>
                    {MANUAL_CASH_IN_SOURCES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-cash-in-note" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                  Note <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="edit-cash-in-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="rounded-xl"
                  rows={2}
                />
                {!noteValid ? <p className="text-xs text-destructive">A note is required.</p> : null}
              </div>

              <DialogDiffPreview changes={diff} />

              <div className="space-y-2">
                <Label htmlFor="edit-cash-in-reason" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                  Reason for change <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="edit-cash-in-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-describedby={reasonHelpId}
                  aria-required
                  maxLength={500}
                  className="rounded-xl min-h-20"
                  placeholder="e.g. Typed the wrong amount"
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
                {editCashIn.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
