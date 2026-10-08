'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Undo2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Textarea,
} from '@water-supply-crm/ui';
import { ledgerCategoryLabel } from '../constants';
import { useDeferLedgerEntry } from '../hooks/use-ledger-entry';
import type { BreakdownLedgerEntry } from '../hooks/use-monthly-payroll';

interface DeferLedgerEntryDialogProps {
  entry: BreakdownLedgerEntry | null;
  /** The payroll period currently showing this entry (the one it is deferred OUT of). */
  periodId: string;
  periodLabel: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Deduct next month" for one ledger deduction (an advance, a penalty...) - or, when the entry is already
 * deferred, undo that. Only moves WHEN payroll deducts it: the entry's own date and the Cash Ledger stay put.
 * To not deduct it at all, use the Waive (void) action on the same row instead.
 */
export function DeferLedgerEntryDialog({ entry, periodId, periodLabel, onOpenChange }: DeferLedgerEntryDialogProps) {
  const defer = useDeferLedgerEntry();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (entry) setReason('');
  }, [entry]);

  if (!entry) return null;

  const undo = !!entry.payrollAttributionDate;
  const originalDay = new Date(entry.effectiveDate);
  const originalMonth = originalDay.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const originalDate = originalDay.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const canSubmit = reason.trim().length >= 5;

  const submit = () => {
    if (!canSubmit) return;
    defer.mutate(
      { id: entry.id, userId: entry.userId, periodId, version: entry.version, reason: reason.trim(), undo },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !defer.isPending && onOpenChange(o)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            {undo ? <Undo2 className="h-5 w-5 text-primary" /> : <CalendarClock className="h-5 w-5 text-primary" />}
            {undo ? 'Undo "Deduct next month"' : 'Deduct next month'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-xl border border-border/40 bg-muted/20 px-3 py-2 text-sm">
            <span className="font-semibold">{ledgerCategoryLabel(entry.category)}</span>
            <span className="font-mono font-bold ml-2">
              {entry.amount >= 0 ? '+' : '−'}₨ {Math.abs(entry.amount).toLocaleString()}
            </span>
            {entry.description && <p className="text-xs text-muted-foreground">{entry.description}</p>}
          </div>

          <p className="text-sm text-muted-foreground">
            {undo
              ? `This entry was moved here from ${originalMonth}. Undoing puts it back in ${originalMonth} (its own date, ${originalDate}), so it stops counting in ${periodLabel}. This only works while ${originalMonth} is not locked yet.`
              : `This ₨ ${Math.abs(entry.amount).toLocaleString()} will NOT be deducted in ${periodLabel}. It will be deducted in the next payroll period instead. The entry's own date and the cash records do not change. If it should not be deducted at all, void (waive) it instead.`}
          </p>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={undo ? 'Why is this being put back?' : 'Why is this being deducted next month?'}
              className="rounded-xl min-h-20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={defer.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit || defer.isPending} className="rounded-xl font-bold">
            {defer.isPending ? 'Saving…' : undo ? 'Undo' : 'Move to next month'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
