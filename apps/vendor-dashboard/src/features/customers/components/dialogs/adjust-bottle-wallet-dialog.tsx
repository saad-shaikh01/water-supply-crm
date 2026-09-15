'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Textarea,
} from '@water-supply-crm/ui';
import { Droplets, ArrowLeft } from 'lucide-react';
import { useAdjustBottleWallet } from '../../hooks/use-customers';
import { useProducts } from '../../../products/hooks/use-products';
import type { BottleWallet } from '@water-supply-crm/types';

interface AdjustBottleWalletDialogProps {
  open: boolean;
  onClose: () => void;
  customerId: string;
  /** Existing wallet rows, used only to look up the current balance per product — a
   * product with no wallet row yet is still selectable and simply starts at 0. */
  wallets: BottleWallet[];
}

type Mode = 'DELTA' | 'SET';

const EMPTY_FORM = { productId: '', mode: 'DELTA' as Mode, amount: '', reason: '' };

export function AdjustBottleWalletDialog({ open, onClose, customerId, wallets }: AdjustBottleWalletDialogProps) {
  const { mutate: adjustWallet, isPending } = useAdjustBottleWallet();
  const { data: productsData } = useProducts();
  const allProducts = productsData?.data ?? [];
  const [form, setForm] = useState(EMPTY_FORM);
  const [step, setStep] = useState<'form' | 'confirm'>('form');

  useEffect(() => {
    if (open && allProducts.length === 1 && !form.productId) {
      setForm((p) => ({ ...p, productId: allProducts[0].id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allProducts]);

  const selectedProduct = useMemo(
    () => allProducts.find((p) => p.id === form.productId) ?? null,
    [allProducts, form.productId],
  );
  const selectedWallet = useMemo(
    () => wallets.find((w) => w.productId === form.productId) ?? null,
    [wallets, form.productId],
  );
  // No existing BottleWallet row for this product yet → starts at 0; the
  // backend's upsert creates the row on save.
  const currentBalance = selectedWallet?.balance ?? 0;

  const amountNum = Number(form.amount);
  const amountValid = form.amount.trim() !== '' && Number.isInteger(amountNum);
  const previewBalance = form.mode === 'SET' ? amountNum : currentBalance + amountNum;
  const reasonValid = form.reason.trim().length >= 3;
  const canReview = !!form.productId && amountValid && reasonValid && previewBalance >= 0;

  const handleClose = () => {
    setForm(EMPTY_FORM);
    setStep('form');
    onClose();
  };

  const handleConfirm = () => {
    adjustWallet(
      {
        customerId,
        productId: form.productId,
        mode: form.mode,
        reason: form.reason.trim(),
        ...(form.mode === 'SET' ? { newBalance: amountNum } : { delta: amountNum }),
      },
      { onSuccess: handleClose },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-sm bg-background/95 backdrop-blur-xl border-border/50">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            {step === 'form' ? 'Adjust Bottle Wallet' : 'Confirm Adjustment'}
          </DialogTitle>
        </DialogHeader>

        {step === 'form' ? (
          <>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Product</Label>
                <select
                  value={form.productId}
                  onChange={(e) => setForm((p) => ({ ...p, productId: e.target.value }))}
                  className="w-full h-11 rounded-xl border border-border/50 bg-background px-3 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">Select product...</option>
                  {allProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {form.productId && (
                <div className="rounded-xl bg-accent/30 px-4 py-3 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Current balance</span>
                  <span className="text-lg font-black font-mono">{currentBalance}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Adjustment mode</Label>
                <select
                  value={form.mode}
                  onChange={(e) => setForm((p) => ({ ...p, mode: e.target.value as Mode, amount: '' }))}
                  className="w-full h-11 rounded-xl border border-border/50 bg-background px-3 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="DELTA">Add / subtract bottles (+/-)</option>
                  <option value="SET">Set exact balance (advanced)</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                  {form.mode === 'DELTA' ? 'Change (e.g. -2 or 3)' : 'New balance'}
                </Label>
                <Input
                  type="number"
                  step={1}
                  placeholder={form.mode === 'DELTA' ? '+/- bottles' : '0'}
                  className="h-11 font-mono font-bold"
                  value={form.amount}
                  onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                />
                {form.productId && amountValid && (
                  <p className="text-xs text-muted-foreground font-medium">
                    New balance will be <span className="font-bold text-foreground">{previewBalance}</span>
                    {previewBalance < 0 && <span className="text-destructive font-bold"> — cannot be negative</span>}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Reason (required)</Label>
                <Textarea
                  placeholder="e.g. Physical recount found 2 extra bottles at customer location"
                  className="min-h-[80px] text-sm"
                  value={form.reason}
                  onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter className="gap-3 border-t pt-6 mt-2">
              <Button variant="ghost" onClick={handleClose} className="rounded-xl">Cancel</Button>
              <Button
                onClick={() => setStep('confirm')}
                disabled={!canReview}
                className="rounded-xl font-bold shadow-lg shadow-primary/20"
              >
                Review Changes
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4 py-4">
              <div className="rounded-xl bg-accent/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground">Product</span>
                  <span className="text-sm font-black">{selectedProduct?.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground">Balance change</span>
                  <span className="text-sm font-black font-mono">
                    {currentBalance} → {previewBalance}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground">Mode</span>
                  <span className="text-sm font-bold">{form.mode === 'DELTA' ? 'Add/subtract' : 'Set exact'}</span>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-bold text-muted-foreground">Reason</span>
                <p className="text-sm font-medium">{form.reason}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                This only corrects the bottle count. It will not change the customer's financial balance,
                transactions, or any report totals.
              </p>
            </div>
            <DialogFooter className="gap-3 border-t pt-6 mt-2">
              <Button variant="ghost" onClick={() => setStep('form')} className="rounded-xl" disabled={isPending}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={isPending}
                className="rounded-xl font-bold shadow-lg shadow-primary/20"
              >
                {isPending ? 'Saving...' : 'Confirm & Save'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
