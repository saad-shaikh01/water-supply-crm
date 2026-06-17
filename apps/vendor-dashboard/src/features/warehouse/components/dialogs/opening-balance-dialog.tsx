'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { Loader2 } from 'lucide-react';
import { useOpeningBalance } from '../../hooks/use-warehouse';

interface Product {
  id: string;
  name: string;
}

interface OpeningBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
}

const defaultForm = {
  productId: '',
  filledCount: 0,
  emptyCount: 0,
  damagedCount: 0,
  leakedCount: 0,
  notes: '',
};

export function OpeningBalanceDialog({ open, onOpenChange, products }: OpeningBalanceDialogProps) {
  const { mutate, isPending } = useOpeningBalance();
  const [form, setForm] = useState(defaultForm);

  useEffect(() => {
    if (open) {
      setForm({ ...defaultForm, productId: products[0]?.id ?? '' });
    }
  }, [open, products]);

  const handleSubmit = () => {
    if (!form.productId) return;
    mutate(
      {
        productId: form.productId,
        filledCount: form.filledCount,
        emptyCount: form.emptyCount,
        damagedCount: form.damagedCount,
        leakedCount: form.leakedCount,
        notes: form.notes || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">Set Opening Balance</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
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
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Filled</Label>
              <Input
                type="number"
                min={0}
                value={form.filledCount}
                onChange={(e) => setForm((p) => ({ ...p, filledCount: Number(e.target.value) }))}
                className="font-mono font-bold"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Empty</Label>
              <Input
                type="number"
                min={0}
                value={form.emptyCount}
                onChange={(e) => setForm((p) => ({ ...p, emptyCount: Number(e.target.value) }))}
                className="font-mono font-bold"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Damaged</Label>
              <Input
                type="number"
                min={0}
                value={form.damagedCount}
                onChange={(e) => setForm((p) => ({ ...p, damagedCount: Number(e.target.value) }))}
                className="font-mono font-bold"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Leaked</Label>
              <Input
                type="number"
                min={0}
                value={form.leakedCount}
                onChange={(e) => setForm((p) => ({ ...p, leakedCount: Number(e.target.value) }))}
                className="font-mono font-bold"
              />
            </div>
          </div>

          <div className="space-y-2">
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
            disabled={isPending || !form.productId}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Set Balance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
