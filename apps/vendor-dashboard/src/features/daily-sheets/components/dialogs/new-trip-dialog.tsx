'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { Package, Loader2 } from 'lucide-react';
import { useCreateLoad } from '../../hooks/use-daily-sheets';
import { productsApi } from '../../../products/api/products.api';

interface NewTripDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  tripNumber: number;
  defaultFilled: number;
}

export function NewTripDialog({ open, onClose, sheetId, tripNumber, defaultFilled }: NewTripDialogProps) {
  const { mutate: createLoad, isPending } = useCreateLoad(sheetId);
  const [filled, setFilled] = useState(defaultFilled);
  const [productId, setProductId] = useState('');

  const { data: productsData } = useQuery({
    queryKey: ['new-trip-products'],
    queryFn: () => productsApi.getAll({ page: 1, limit: 100, isActive: true }).then((r) => r.data),
  });

  const products: { id: string; name: string }[] =
    (productsData as any)?.data ?? (productsData as any)?.items ?? [];

  useEffect(() => {
    if (open) {
      setFilled(defaultFilled);
      setProductId(products[0]?.id ?? '');
    }
  }, [open, defaultFilled]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Start Load-Out
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {products.length > 1 && (
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Product</Label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id} className="bg-background text-foreground dark:text-white">
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Trip {tripNumber} — Filled Bottles Dispatched
            </Label>
            <Input
              type="number"
              min={1}
              value={filled}
              onChange={(e) => setFilled(Number(e.target.value))}
              className="h-14 text-3xl font-black font-mono text-center"
            />
            <p className="text-[11px] text-muted-foreground">Total filled bottles loaded into the van for this trip.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => createLoad(
              { loadedFilled: filled, ...(productId ? { productId } : {}) },
              { onSuccess: onClose },
            )}
            disabled={isPending || filled < 1}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Confirm Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
