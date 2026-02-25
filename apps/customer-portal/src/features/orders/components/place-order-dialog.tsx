'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Button, Label, Input,
} from '@water-supply-crm/ui';
import { Loader2, ShoppingCart } from 'lucide-react';
import { usePortalProducts } from '../../wallet/hooks/use-wallet';
import { usePlaceOrder } from '../hooks/use-orders';

interface PlaceOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlaceOrderDialog({ open, onOpenChange }: PlaceOrderDialogProps) {
  const { data: products = [] } = usePortalProducts();
  const { mutate: placeOrder, isPending } = usePlaceOrder();

  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [preferredDate, setPreferredDate] = useState('');

  const reset = () => {
    setProductId('');
    setQuantity(1);
    setNote('');
    setPreferredDate('');
  };

  const handleSubmit = () => {
    if (!productId || quantity < 1) return;
    placeOrder(
      { productId, quantity, note: note || undefined, preferredDate: preferredDate || undefined },
      { onSuccess: () => { onOpenChange(false); reset(); } },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-md rounded-3xl border-border/50 bg-card/90 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Place an Order
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground uppercase tracking-widest font-bold">
            Request extra delivery outside your schedule
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Product */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-wider">Product</Label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">Select a product...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ₨{p.basePrice}/unit
                </option>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-wider">Quantity</Label>
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
              className="rounded-xl"
            />
          </div>

          {/* Preferred Date (optional) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-wider">
              Preferred Date <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              type="date"
              value={preferredDate}
              onChange={(e) => setPreferredDate(e.target.value)}
              className="rounded-xl"
            />
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase tracking-wider">
              Note <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any special instructions..."
              rows={3}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!productId || quantity < 1 || isPending}
            className="w-full rounded-2xl font-bold gap-2 shadow-lg shadow-primary/20"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
            Place Order
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
