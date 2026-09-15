'use client';

import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Textarea,
} from '@water-supply-crm/ui';
import { useVoidFuelCardTopUp } from '../hooks/use-fuel-cards';

export interface TopUpVoidTarget {
  id: string;
  amount: number;
  cardName: string;
}

interface VoidTopUpDialogProps {
  target: TopUpVoidTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VoidTopUpDialog({ target, open, onOpenChange }: VoidTopUpDialogProps) {
  const voidTopUp = useVoidFuelCardTopUp();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  if (!target) return null;

  const canSubmit = reason.trim().length >= 10;

  const handleVoid = () => {
    if (!canSubmit) return;
    voidTopUp.mutate(
      { id: target.id, data: { voidReason: reason.trim() } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Void Top-up
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Voiding removes <span className="font-bold text-foreground">₨ {target.amount.toLocaleString()}</span>{' '}
            (on {target.cardName}) from both the card balance and office cash. The row stays visible for the
            audit trail — nothing is deleted.
          </p>
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="At least 10 characters — why is this top-up being voided?"
              className="rounded-xl min-h-20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={!canSubmit || voidTopUp.isPending}
            className="rounded-xl font-bold"
          >
            {voidTopUp.isPending ? 'Voiding…' : 'Void Top-up'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
