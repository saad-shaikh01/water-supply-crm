'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Textarea } from '@water-supply-crm/ui';
import { NativeSelect } from '../../observability/components/native-select';
import { VendorSelect } from '../../vendor-picker/vendor-select';
import { useCreateInvoice, useInvoice, useRecordPayment, useVoidInvoice } from '../hooks/use-billing';
import { PAYMENT_METHODS, type Invoice } from '../api/billing.api';
import { dateInputToIso, fmtDate, isOverdue, money, remaining, todayInput } from '../lib/billing';

export function InvoiceStatusBadge({ invoice }: { invoice: Pick<Invoice, 'status' | 'dueAt'> }) {
  if (isOverdue(invoice)) {
    return (
      <Badge variant="destructive" data-status="OVERDUE">
        Overdue
      </Badge>
    );
  }
  const v = { DRAFT: 'outline', OPEN: 'info', PAID: 'success', VOID: 'secondary' } as const;
  return (
    <Badge variant={v[invoice.status]} data-status={invoice.status}>
      {invoice.status}
    </Badge>
  );
}

const amountRule = z
  .string()
  .trim()
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) >= 0.01, 'Enter an amount above 0 (max 2 decimals)');

export const createInvoiceSchema = z.object({
  vendorId: z.string().min(1, 'Select a vendor'),
  amount: amountRule,
  description: z.string().max(500, 'Max 500 characters'),
  dueAt: z.string().min(1, 'Due date is required'),
  asDraft: z.boolean(),
});
type CreateValues = z.infer<typeof createInvoiceSchema>;

export function CreateInvoiceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateInvoice();
  const { register, handleSubmit, reset, setValue, watch, formState } = useForm<CreateValues>({
    resolver: zodResolver(createInvoiceSchema),
    defaultValues: { vendorId: '', amount: '', description: '', dueAt: '', asDraft: false },
  });
  const { errors } = formState;
  useEffect(() => {
    if (open) reset({ vendorId: '', amount: '', description: '', dueAt: todayInput(), asDraft: false });
  }, [open, reset]);

  const submit = handleSubmit((v) =>
    create.mutate(
      {
        vendorId: v.vendorId,
        amount: Number(v.amount),
        dueAt: dateInputToIso(v.dueAt),
        status: v.asDraft ? 'DRAFT' : 'OPEN',
        ...(v.description.trim() ? { description: v.description.trim() } : {}),
      },
      { onSuccess: onClose },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create invoice</DialogTitle>
          <DialogDescription>The invoice number is assigned automatically.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <VendorSelect id="inv-vendor" value={watch('vendorId')} onChange={(id) => setValue('vendorId', id, { shouldValidate: true })} error={errors.vendorId?.message} />
          <div className="space-y-1">
            <Label htmlFor="inv-amount">Amount (PKR)</Label>
            <Input id="inv-amount" inputMode="decimal" {...register('amount')} aria-invalid={!!errors.amount} />
            {errors.amount && (
              <p className="text-xs text-destructive" role="alert">
                {errors.amount.message}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-due">Due date</Label>
            <Input id="inv-due" type="date" {...register('dueAt')} aria-invalid={!!errors.dueAt} />
            {errors.dueAt && (
              <p className="text-xs text-destructive" role="alert">
                {errors.dueAt.message}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-desc">Description</Label>
            <Input id="inv-desc" {...register('description')} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" id="inv-draft" {...register('asDraft')} /> Save as draft (issue later)
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating...' : 'Create invoice'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const paymentSchema = z.object({
  amount: amountRule,
  method: z.enum(['CASH', 'BANK_TRANSFER', 'RAAST', 'CHEQUE', 'OTHER']),
  paidOn: z.string().min(1, 'Payment date is required'),
  reference: z.string().max(200, 'Max 200 characters'),
  notes: z.string().max(1000, 'Max 1000 characters'),
});
type PaymentValues = z.infer<typeof paymentSchema>;

export function RecordPaymentDialog({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const detail = useInvoice(invoice?.id ?? null);
  const pay = useRecordPayment();
  const full = detail.data ?? invoice;
  const left = full ? remaining(full) : 0;
  const { register, handleSubmit, reset, setError, formState } = useForm<PaymentValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { amount: '', method: 'BANK_TRANSFER', paidOn: '', reference: '', notes: '' },
  });
  const { errors } = formState;
  useEffect(() => {
    if (invoice) reset({ amount: '', method: 'BANK_TRANSFER', paidOn: todayInput(), reference: '', notes: '' });
  }, [invoice, reset]);

  const submit = handleSubmit((v) => {
    if (!invoice) return;
    if (Number(v.amount) > left + 0.0001) {
      return setError('amount', { message: `Amount exceeds the remaining balance (${money(left, invoice.currency)})` });
    }
    pay.mutate(
      {
        id: invoice.id,
        body: {
          amount: Number(v.amount),
          method: v.method,
          paidOn: dateInputToIso(v.paidOn),
          ...(v.reference.trim() ? { reference: v.reference.trim() } : {}),
          ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
        },
      },
      { onSuccess: onClose },
    );
  });

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment {invoice ? `for ${invoice.number}` : ''}</DialogTitle>
          <DialogDescription data-testid="payment-remaining">
            {full ? `Invoice total ${money(full.amount, full.currency)}. Remaining balance ${money(left, full.currency)}.` : ''}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <div className="space-y-1">
            <Label htmlFor="pay-amount">Amount</Label>
            <Input id="pay-amount" inputMode="decimal" {...register('amount')} aria-invalid={!!errors.amount} />
            {errors.amount && (
              <p className="text-xs text-destructive" role="alert">
                {errors.amount.message}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pay-method">Method</Label>
              <NativeSelect id="pay-method" {...register('method')}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pay-date">Paid on</Label>
              <Input id="pay-date" type="date" {...register('paidOn')} aria-invalid={!!errors.paidOn} />
              {errors.paidOn && (
                <p className="text-xs text-destructive" role="alert">
                  {errors.paidOn.message}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-ref">Reference</Label>
            <Input id="pay-ref" placeholder="Bank transaction / receipt no." {...register('reference')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-notes">Notes</Label>
            <Input id="pay-notes" {...register('notes')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pay.isPending || detail.isLoading}>
              {pay.isPending ? 'Recording...' : 'Record payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VoidInvoiceDialog({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const voidInv = useVoidInvoice();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    setReason('');
    setErr('');
  }, [invoice]);

  const submit = () => {
    if (!invoice) return;
    if (!reason.trim()) return setErr('A reason is required');
    if (reason.length > 500) return setErr('Max 500 characters');
    voidInv.mutate({ id: invoice.id, reason: reason.trim() }, { onSuccess: onClose });
  };

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void invoice {invoice?.number}</DialogTitle>
          <DialogDescription>An invoice that already has payments cannot be voided.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="void-reason">Reason</Label>
          <Textarea
            id="void-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setErr('');
            }}
            aria-invalid={!!err}
          />
          {err && (
            <p className="text-xs text-destructive" role="alert">
              {err}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={voidInv.isPending} onClick={submit}>
            {voidInv.isPending ? 'Voiding...' : 'Void invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { fmtDate };
