'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { Loader2 } from 'lucide-react';
import { useReturnRepair } from '../../hooks/use-warehouse';
import type { RepairBatch } from '../../api/warehouse.api';

interface ReturnRepairDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: RepairBatch | null;
}

const defaultForm = { bottlesReturned: 0, bottlesWrittenOff: 0, notes: '' };

export function ReturnRepairDialog({ open, onOpenChange, batch }: ReturnRepairDialogProps) {
  const { mutate, isPending } = useReturnRepair();
  const [form, setForm] = useState(defaultForm);

  useEffect(() => {
    if (open) setForm(defaultForm);
  }, [open]);

  if (!batch) return null;

  const alreadyReturned = batch.bottlesReturned + batch.bottlesWrittenOff;
  const remaining = batch.bottlesSent - alreadyReturned;
  const total = form.bottlesReturned + form.bottlesWrittenOff;
  const isOverflow = total > remaining;

  const handleSubmit = () => {
    if (!batch || isOverflow || total < 1) return;
    mutate(
      { batchId: batch.id, data: { bottlesReturned: form.bottlesReturned, bottlesWrittenOff: form.bottlesWrittenOff, notes: form.notes || undefined } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-black text-emerald-500">Return from Repair</DialogTitle>
        </DialogHeader>
        <div className="rounded-xl bg-muted/30 border border-border/30 px-4 py-3 space-y-1 text-sm">
          <p className="font-bold text-foreground dark:text-white">{batch.shopName}</p>
          <p className="text-muted-foreground">Product: <span className="font-semibold text-foreground">{batch.product.name}</span></p>
          <p className="text-muted-foreground">Sent: <span className="font-bold font-mono text-foreground">{batch.bottlesSent}</span></p>
          <p className="text-muted-foreground">Previously returned: <span className="font-bold font-mono text-foreground">{alreadyReturned}</span></p>
          <p className="text-muted-foreground">Remaining: <span className="font-bold font-mono text-foreground">{remaining}</span></p>
        </div>
        <div className="grid grid-cols-2 gap-3 py-4">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Returned</Label>
            <Input
              type="number"
              min={0}
              value={form.bottlesReturned}
              onChange={(e) => setForm((p) => ({ ...p, bottlesReturned: Number(e.target.value) }))}
              className="font-mono font-bold"
            />
          </div>
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Written Off</Label>
            <Input
              type="number"
              min={0}
              value={form.bottlesWrittenOff}
              onChange={(e) => setForm((p) => ({ ...p, bottlesWrittenOff: Number(e.target.value) }))}
              className="font-mono font-bold"
            />
          </div>
          {isOverflow && (
            <p className="col-span-2 text-xs text-red-500 font-semibold">
              Total ({total}) exceeds remaining ({remaining}).
            </p>
          )}
          <div className="col-span-2 space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Notes (optional)</Label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              rows={2}
              className="w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              placeholder="Optional notes..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || isOverflow || total < 1}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Record Return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
