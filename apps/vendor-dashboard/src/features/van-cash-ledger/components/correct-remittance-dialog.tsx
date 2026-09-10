'use client';

import { useEffect, useState } from 'react';
import { PencilLine } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Textarea,
} from '@water-supply-crm/ui';
import { useCorrectRemittance } from '../hooks/use-van-cash-ledger';

export interface RemittanceCorrectTarget {
  sourceRecordId: string;
  amount: number;
  destinationLabel: string;
  version: number;
}

interface CorrectRemittanceDialogProps {
  target: RemittanceCorrectTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CorrectRemittanceDialog({ target, open, onOpenChange }: CorrectRemittanceDialogProps) {
  const correctRemittance = useCorrectRemittance();
  const [newAmount, setNewAmount] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open && target) {
      // Left blank on purpose — the field is the NEW TOTAL for the whole
      // handover, not a tweak of the shown figure. Forcing a fresh entry
      // stops an accidental submit of a pre-filled (possibly wrong) number.
      setNewAmount('');
      setReference('');
      setReason('');
    }
  }, [open, target]);

  if (!target) return null;

  const parsed = Number(newAmount);
  const amountValid = newAmount !== '' && !Number.isNaN(parsed) && parsed > 0;
  const changed = amountValid && parsed !== target.amount;
  const canSubmit = amountValid && changed && reason.trim().length >= 10;

  const handleCorrect = () => {
    if (!canSubmit) return;
    correctRemittance.mutate(
      {
        id: target.sourceRecordId,
        data: {
          version: target.version,
          newAmount: parsed,
          reference: reference.trim() || undefined,
          correctionReason: reason.trim(),
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <PencilLine className="h-5 w-5 text-amber-500" />
            Correct Owner Handover
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Enter the corrected <span className="font-bold text-foreground">total</span> for this handover
            (to {target.destinationLabel}) — not the change, the full amount it should be. If it is already
            approved, the difference is posted as a new pending correction that needs its own approval.
          </p>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              New Total <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              placeholder={`Currently recorded: ₨ ${target.amount.toLocaleString()}`}
              className="h-10 rounded-xl"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reference
            </Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="h-10 rounded-xl"
              placeholder="Updated deposit slip / cheque #"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="At least 10 characters — what was wrong and why?"
              className="rounded-xl min-h-16"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleCorrect}
            disabled={!canSubmit || correctRemittance.isPending}
            className="rounded-xl font-bold"
          >
            {correctRemittance.isPending ? 'Submitting…' : 'Submit Correction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
