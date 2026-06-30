'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { Tag } from 'lucide-react';
import { useSetCustomPrice } from '../../hooks/use-customers';
import { useProducts } from '../../../products/hooks/use-products';

interface CustomPriceDialogProps {
  open: boolean;
  onClose: () => void;
  customerId: string;
}

export function CustomPriceDialog({ open, onClose, customerId }: CustomPriceDialogProps) {
  const { mutate: setCustomPrice, isPending } = useSetCustomPrice();
  const { data: productsData } = useProducts();
  const allProducts = productsData?.data ?? [];

  const [form, setForm] = useState({ productId: '', customPrice: '' });

  useEffect(() => {
    if (allProducts.length === 1 && !form.productId) {
      setForm((p) => ({ ...p, productId: allProducts[0].id }));
    }
  }, [allProducts, open]);

  const handleClose = () => {
    setForm({ productId: '', customPrice: '' });
    onClose();
  };

  const handleSubmit = () => {
    setCustomPrice(
      { customerId, data: { productId: form.productId, price: Number(form.customPrice) } },
      { onSuccess: handleClose },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-sm bg-background/95 backdrop-blur-xl border-border/50">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" /> Set Custom Price
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Product</Label>
            <select
              value={form.productId}
              onChange={(e) => setForm((p) => ({ ...p, productId: e.target.value }))}
              className="w-full h-11 rounded-xl border border-border/50 bg-background px-3 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">Select product...</option>
              {allProducts.map((pr) => (
                <option key={pr.id} value={pr.id}>{pr.name} (Base: ₨{pr.basePrice})</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Custom Price (₨)</Label>
            <Input
              type="number"
              placeholder="0.00"
              className="h-11 font-mono font-bold"
              value={form.customPrice}
              onChange={(e) => setForm((p) => ({ ...p, customPrice: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter className="gap-3 border-t pt-6 mt-2">
          <Button variant="ghost" onClick={handleClose} className="rounded-xl">Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !form.productId || !form.customPrice}
            className="rounded-xl font-bold shadow-lg shadow-primary/20"
          >
            {isPending ? 'Saving...' : 'Save Price'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
