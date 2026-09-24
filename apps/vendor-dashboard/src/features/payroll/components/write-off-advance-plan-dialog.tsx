'use client';

import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Textarea,
} from '@water-supply-crm/ui';
import type { StaffAdvancePlan } from '@water-supply-crm/types';
import { useWriteOffAdvancePlan } from '../hooks/use-advance-plans';

/**
 * Write off / forgive an advance plan's remaining balance (owner-requested
 * 2026-09-25) — e.g. the employee resigned and the rest is unrecoverable.
 * Mirrors `void-salary-structure-dialog.tsx`'s confirmation-dialog UX
 * (mandatory reason, minimum length). No cash/ledger effect — the principal
 * already left as a real cash disbursement; this only stops future
 * installments from ever being generated for this plan.
 */
interface WriteOffAdvancePlanDialogProps {
  plan: StaffAdvancePlan | null;
  employeeId: string;
  entryId?: string;
  onOpenChange: (open: boolean) => void;
}

export function WriteOffAdvancePlanDialog({ plan, employeeId, entryId, onOpenChange }: WriteOffAdvancePlanDialogProps) {
  const writeOff = useWriteOffAdvancePlan(employeeId, entryId);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (plan) setReason('');
  }, [plan]);

  if (!plan) return null;

  const canSubmit = reason.trim().length >= 10;

  const handleWriteOff = () => {
    if (!canSubmit) return;
    writeOff.mutate(
      { id: plan.id, data: { reason: reason.trim() } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!plan} onOpenChange={(o) => !writeOff.isPending && onOpenChange(o)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Write Off Advance Plan
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Forgives the remaining balance on this ₨ {plan.principalAmount.toLocaleString()} advance — no further
            installments will ever be generated for it. The cash already disbursed is unaffected; this is not a
            ledger transaction against the employee.
          </p>
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="At least 10 characters — why is the remaining balance being forgiven?"
              className="rounded-xl min-h-20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={writeOff.isPending}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleWriteOff}
            disabled={!canSubmit || writeOff.isPending}
            className="rounded-xl font-bold"
          >
            {writeOff.isPending ? 'Writing off…' : 'Write Off'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
