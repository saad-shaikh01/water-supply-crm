'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { PlusCircle } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@water-supply-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../../products/api/products.api';
import type { PaginatedResponse, ProductSummary } from '@water-supply-crm/types';
import { apiErrorMessage, type DepositType } from '../api/customer-deposits.api';
import { useCollectDeposit } from '../hooks/use-customer-deposits';

const SELECT_CLASS =
  'h-10 w-full rounded-xl bg-background/50 border border-border text-sm text-foreground dark:text-white px-3 outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer';
const FIELD_LABEL = 'font-bold text-xs uppercase tracking-widest text-muted-foreground';

interface CollectDepositDialogProps {
  customerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Records a deposit collected FROM the customer at the office — CASH (a Rs.
 * amount) or BOTTLE (bottles the customer owns, handed over as security,
 * count-only, no cash value, per-product). Reused whether this is the
 * customer's first deposit or an additional collection on top of an existing
 * one (the backend finds or creates the underlying CustomerDeposit row).
 */
export function CollectDepositDialog({ customerId, open, onOpenChange }: CollectDepositDialogProps) {
  const collect = useCollectDeposit(customerId);
  const { data: productsPage } = useQuery({
    queryKey: ['products', 'active-for-deposit'],
    queryFn: () =>
      productsApi.getAll({ isActive: true, limit: 100 }).then((r) => r.data as PaginatedResponse<ProductSummary>),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });
  const products = productsPage?.data ?? [];

  const [type, setType] = useState<DepositType>('CASH');
  const [productId, setProductId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      setType('CASH');
      setProductId('');
      setAmount('');
      setNote('');
      setAttempted(false);
      collect.reset();
    }
    // Only when the dialog opens: `collect` changes identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsedAmount = amount.trim() === '' ? null : Number(amount);
  const amountInvalid =
    parsedAmount === null ||
    !Number.isFinite(parsedAmount) ||
    parsedAmount <= 0 ||
    (type === 'BOTTLE' && !Number.isInteger(parsedAmount));
  const productMissing = type === 'BOTTLE' && !productId;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (collect.isPending) return;
    setAttempted(true);
    if (amountInvalid || productMissing) return;
    collect.mutate(
      {
        type,
        productId: type === 'BOTTLE' ? productId : undefined,
        amount: parsedAmount as number,
        note: note.trim() || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-primary" /> Collect deposit
          </DialogTitle>
          <DialogDescription>
            A refundable security deposit — kept separate from what the customer owes for deliveries.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className={FIELD_LABEL}>Type</Label>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as DepositType);
                setProductId('');
              }}
              className={SELECT_CLASS}
            >
              <option value="CASH" className="bg-background text-foreground dark:text-white">
                Cash deposit
              </option>
              <option value="BOTTLE" className="bg-background text-foreground dark:text-white">
                Bottle deposit
              </option>
            </select>
          </div>

          {type === 'BOTTLE' && (
            <div className="space-y-2">
              <Label className={FIELD_LABEL}>
                Product <span className="text-destructive">*</span>
              </Label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className={SELECT_CLASS}>
                <option value="">Choose…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id} className="bg-background text-foreground dark:text-white">
                    {p.name}
                  </option>
                ))}
              </select>
              {attempted && productMissing && <p className="text-xs text-destructive">A product is required.</p>}
            </div>
          )}

          <div className="space-y-2">
            <Label className={FIELD_LABEL}>
              {type === 'CASH' ? 'Amount (₨)' : 'Bottles'} <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              min={0}
              step={type === 'CASH' ? '0.01' : '1'}
              inputMode={type === 'CASH' ? 'decimal' : 'numeric'}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={type === 'CASH' ? '0.00' : '0'}
              className="h-10 rounded-xl"
            />
            {attempted && amountInvalid && (
              <p className="text-xs text-destructive">
                {type === 'BOTTLE' ? 'A whole number of bottles is required.' : 'A positive amount is required.'}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label className={FIELD_LABEL}>Note</Label>
            <Textarea
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
              className="rounded-xl min-h-16"
            />
          </div>

          {collect.isError && (
            <div role="alert" className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
              {apiErrorMessage(collect.error, 'Failed to collect the deposit')}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={collect.isPending} className="rounded-xl font-bold">
              {collect.isPending ? 'Collecting…' : 'Collect deposit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
