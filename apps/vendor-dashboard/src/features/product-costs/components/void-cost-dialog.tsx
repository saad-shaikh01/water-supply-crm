'use client';

import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Textarea,
} from '@water-supply-crm/ui';
import { useVoidProductCost } from '../hooks/use-product-costs';
import type { ProductCost } from '../api/product-costs.api';

/**
 * Void the current/open cost row (design doc §4.3/§7.4) — mirrors
 * `void-topup-dialog.tsx`'s confirmation-dialog UX (mandatory reason,
 * disabled submit until a minimum length is met) for the same caution level
 * as voiding any other financial-history record in this app.
 */
interface VoidCostDialogProps {
  row: ProductCost | null;
  productId: string;
  onOpenChange: (open: boolean) => void;
}

export function VoidCostDialog({ row, productId, onOpenChange }: VoidCostDialogProps) {
  const voidCost = useVoidProductCost();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (row) setReason('');
  }, [row]);

  if (!row) return null;

  const canSubmit = reason.trim().length >= 10;

  const handleVoid = () => {
    if (!canSubmit) return;
    voidCost.mutate(
      { id: row.id, productId, kind: row.kind, data: { voidReason: reason.trim() } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => !voidCost.isPending && onOpenChange(o)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Void Cost Row
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Voiding removes the <span className="font-bold text-foreground">₨ {row.costPerUnit.toLocaleString()} per unit</span>{' '}
            rate effective {new Date(row.effectiveFrom).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
            and reopens whichever row it superseded. The row stays visible, struck through, for the audit trail — nothing is deleted.
          </p>
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="At least 10 characters — why is this cost row being voided?"
              className="rounded-xl min-h-20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={voidCost.isPending}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={!canSubmit || voidCost.isPending}
            className="rounded-xl font-bold"
          >
            {voidCost.isPending ? 'Voiding…' : 'Void Cost Row'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
