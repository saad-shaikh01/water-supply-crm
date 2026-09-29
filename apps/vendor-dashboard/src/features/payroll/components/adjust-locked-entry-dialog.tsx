'use client';

import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Textarea,
} from '@water-supply-crm/ui';
import { ledgerCategoryLabel } from '../constants';
import { useAdjustLockedLedgerEntry } from '../hooks/use-ledger-entry';
import type { BreakdownLedgerEntry } from '../hooks/use-monthly-payroll';

export type AdjustMode = 'reverse' | 'correct';

/**
 * Fix an entry that is already frozen inside a locked payroll period. The locked row is
 * never edited — a new opposite-sign entry is posted dated today, so the fix lands in
 * the currently OPEN period. Reverse = cancel it; Correct = cancel it and post the right amount.
 */
interface AdjustLockedEntryDialogProps {
  entry: BreakdownLedgerEntry | null;
  onOpenChange: (open: boolean) => void;
  canReverse: boolean;
  canCorrect: boolean;
}

export function AdjustLockedEntryDialog({ entry, onOpenChange, canReverse, canCorrect }: AdjustLockedEntryDialogProps) {
  const adjust = useAdjustLockedLedgerEntry();
  const [mode, setMode] = useState<AdjustMode>('reverse');
  const [reason, setReason] = useState('');
  const [amountStr, setAmountStr] = useState('');

  useEffect(() => {
    if (entry) {
      setMode(canReverse ? 'reverse' : 'correct');
      setReason('');
      setAmountStr('');
    }
  }, [entry, canReverse]);

  if (!entry) return null;

  const corrected = Number(amountStr);
  const amountOk = mode === 'reverse' || (amountStr.trim() !== '' && Number.isInteger(corrected) && corrected !== 0);
  const canSubmit = reason.trim().length >= 5 && amountOk;

  const submit = () => {
    if (!canSubmit) return;
    adjust.mutate(
      {
        id: entry.id,
        userId: entry.userId,
        version: entry.version,
        reason: reason.trim(),
        correctedAmount: mode === 'correct' ? corrected : undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !adjust.isPending && onOpenChange(o)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Undo2 className="h-5 w-5 text-primary" />
            Fix Locked Entry
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

          <div className="flex gap-2">
            {canReverse && (
              <Button size="sm" variant={mode === 'reverse' ? 'default' : 'outline'} className="rounded-lg text-xs font-bold" onClick={() => setMode('reverse')}>
                Reverse
              </Button>
            )}
            {canCorrect && (
              <Button size="sm" variant={mode === 'correct' ? 'default' : 'outline'} className="rounded-lg text-xs font-bold" onClick={() => setMode('correct')}>
                Correct Amount
              </Button>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            This period is locked, so the original stays as-is. A new entry dated today is posted in the
            <strong> currently open period</strong>
            {mode === 'reverse'
              ? ` to cancel it (${entry.amount >= 0 ? '−' : '+'}₨ ${Math.abs(entry.amount).toLocaleString()}).`
              : ' that cancels it, plus a second entry with the correct amount.'}
          </p>

          {mode === 'correct' && (
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Correct amount (₨) <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number" step={1}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="Signed — credit +, deduction −"
                className="h-9 font-mono font-bold"
              />
              <p className="text-[11px] text-muted-foreground">
                Same sign convention as the list: original was {entry.amount >= 0 ? '+' : '−'}₨ {Math.abs(entry.amount).toLocaleString()}.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What was wrong with this entry?"
              className="rounded-xl min-h-20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={adjust.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit || adjust.isPending} className="rounded-xl font-bold">
            {adjust.isPending ? 'Saving…' : mode === 'reverse' ? 'Reverse Entry' : 'Correct Entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
