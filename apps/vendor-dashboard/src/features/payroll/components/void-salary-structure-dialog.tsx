'use client';

import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Textarea,
} from '@water-supply-crm/ui';
import type { SalaryStructure } from '@water-supply-crm/types';
import { useVoidSalaryStructure } from '../hooks/use-salary-structure';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Void the current/open salary structure row (owner-requested 2026-09-25) —
 * mirrors `void-cost-dialog.tsx`'s confirmation-dialog UX (mandatory reason,
 * disabled submit until a minimum length is met) for the same caution level
 * as voiding any other financial-history record in this app. Only the
 * current row is ever voidable (enforced server-side) — this dialog is only
 * ever opened from that row.
 */
interface VoidSalaryStructureDialogProps {
  row: SalaryStructure | null;
  employeeId: string;
  onOpenChange: (open: boolean) => void;
}

export function VoidSalaryStructureDialog({ row, employeeId, onOpenChange }: VoidSalaryStructureDialogProps) {
  const voidStructure = useVoidSalaryStructure(employeeId);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (row) setReason('');
  }, [row]);

  if (!row) return null;

  const canSubmit = reason.trim().length >= 10;

  const handleVoid = () => {
    if (!canSubmit) return;
    voidStructure.mutate(
      { id: row.id, data: { voidReason: reason.trim() } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => !voidStructure.isPending && onOpenChange(o)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Void Salary Structure Row
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Voiding removes the <span className="font-bold text-foreground">₨ {row.baseAmount.toLocaleString()}</span>{' '}
            rate effective {formatDate(row.effectiveFrom)} and reopens whichever row it superseded. The row stays
            visible, struck through, for the audit trail — nothing is deleted.
          </p>
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="At least 10 characters — why is this row being voided? (e.g. wrong amount, wrong effective date)"
              className="rounded-xl min-h-20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={voidStructure.isPending}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={!canSubmit || voidStructure.isPending}
            className="rounded-xl font-bold"
          >
            {voidStructure.isPending ? 'Voiding…' : 'Void Row'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
