'use client';

import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Textarea,
} from '@water-supply-crm/ui';
import { useVoidStandaloneCrewCash } from '../../crew-cash/hooks/use-crew-cash';
import { money } from '../format';

export interface CrewCashVoidTarget {
  /** The standalone crew-cash record id (`sourceRecordId` on the ledger row). */
  id: string;
  amount: number;
  employeeName: string | null;
}

interface VoidCrewCashDialogProps {
  target: CrewCashVoidTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MIN_REASON = 5;

export function VoidCrewCashDialog({ target, open, onOpenChange }: VoidCrewCashDialogProps) {
  const voidCrewCash = useVoidStandaloneCrewCash();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  if (!target) return null;

  const canSubmit = reason.trim().length >= MIN_REASON;

  const handleVoid = () => {
    if (!canSubmit) return;
    voidCrewCash.mutate(
      { id: target.id, reason: reason.trim() },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Void Crew Cash
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Voiding removes <span className="font-bold text-foreground">{money(target.amount)}</span>
            {target.employeeName ? (
              <> (paid to <span className="font-bold text-foreground">{target.employeeName}</span>)</>
            ) : null}{' '}
            from office cash. The row stays visible for the audit trail — nothing is deleted.
          </p>
          <p className="text-xs rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-500 px-3 py-2">
            The linked payroll entry is voided (reversed) as well, so the employee&apos;s payroll balance is
            restored.
          </p>
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={`At least ${MIN_REASON} characters — why is this entry being voided?`}
              className="rounded-xl min-h-20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={!canSubmit || voidCrewCash.isPending}
            className="rounded-xl font-bold"
          >
            {voidCrewCash.isPending ? 'Voiding…' : 'Void Crew Cash'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
