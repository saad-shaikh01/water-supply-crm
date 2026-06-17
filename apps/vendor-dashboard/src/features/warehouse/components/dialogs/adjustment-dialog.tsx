'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { Loader2 } from 'lucide-react';
import { useAdjustment } from '../../hooks/use-warehouse';

interface Product {
  id: string;
  name: string;
}

interface AdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
}

const defaultForm = {
  productId: '',
  filledAdjust: 0,
  emptyAdjust: 0,
  damagedAdjust: 0,
  leakedAdjust: 0,
  notes: '',
};

export function AdjustmentDialog({ open, onOpenChange, products }: AdjustmentDialogProps) {
  const { mutate, isPending } = useAdjustment();
  const [form, setForm] = useState(defaultForm);

  useEffect(() => {
    if (open) setForm({ ...defaultForm, productId: products[0]?.id ?? '' });
  }, [open, products]);

  const handleSubmit = () => {
    if (!form.productId || !form.notes.trim()) return;
    mutate(
      {
        productId: form.productId,
        filledAdjust: form.filledAdjust,
        emptyAdjust: form.emptyAdjust,
        damagedAdjust: form.damagedAdjust,
        leakedAdjust: form.leakedAdjust,
        notes: form.notes.trim(),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black text-yellow-500">Manual Adjustment</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2 pb-2">Use positive or negative integers to adjust counts.</p>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Product</Label>
            <select
              value={form.productId}
              onChange={(e) => setForm((p) => ({ ...p, productId: e.target.value }))}
              className="w-full h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30"
            >
              {products.map((product) => (
                <option key={product.id} value={product.id} className="bg-background text-foreground dark:text-white">
                  {product.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Filled Adjust</Label>
              <Input
                type="number"
                value={form.filledAdjust}
                onChange={(e) => setForm((p) => ({ ...p, filledAdjust: Number(e.target.value) }))}
                className="font-mono font-bold"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Empty Adjust</Label>
              <Input
                type="number"
                value={form.emptyAdjust}
                onChange={(e) => setForm((p) => ({ ...p, emptyAdjust: Number(e.target.value) }))}
                className="font-mono font-bold"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Damaged Adjust</Label>
              <Input
                type="number"
                value={form.damagedAdjust}
                onChange={(e) => setForm((p) => ({ ...p, damagedAdjust: Number(e.target.value) }))}
                className="font-mono font-bold"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Leaked Adjust</Label>
              <Input
                type="number"
                value={form.leakedAdjust}
                onChange={(e) => setForm((p) => ({ ...p, leakedAdjust: Number(e.target.value) }))}
                className="font-mono font-bold"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Notes (required)</Label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              rows={2}
              className="w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              placeholder="Reason for adjustment (required)..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !form.productId || !form.notes.trim()}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Apply Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
