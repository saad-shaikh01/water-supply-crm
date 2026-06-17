'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { Loader2 } from 'lucide-react';
import { useFillIn } from '../../hooks/use-warehouse';

interface Product {
  id: string;
  name: string;
}

interface FillInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
}

const defaultForm = { productId: '', quantity: 1, notes: '' };

export function FillInDialog({ open, onOpenChange, products }: FillInDialogProps) {
  const { mutate, isPending } = useFillIn();
  const [form, setForm] = useState(defaultForm);

  useEffect(() => {
    if (open) setForm({ ...defaultForm, productId: products[0]?.id ?? '' });
  }, [open, products]);

  const handleSubmit = () => {
    if (!form.productId || form.quantity < 1) return;
    mutate(
      { productId: form.productId, quantity: form.quantity, notes: form.notes || undefined },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">Fill In</DialogTitle>
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
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Quantity</Label>
            <Input
              type="number"
              min={1}
              value={form.quantity}
              onChange={(e) => setForm((p) => ({ ...p, quantity: Number(e.target.value) }))}
              className="h-14 text-3xl font-black font-mono text-center"
            />
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
            disabled={isPending || !form.productId || form.quantity < 1}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Record Fill-In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
