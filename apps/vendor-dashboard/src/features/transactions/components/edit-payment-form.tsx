'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { CreditCard, FileText } from 'lucide-react';
import { editPaymentSchema, type EditPaymentInput } from '../schemas';
import { useEditPayment } from '../hooks/use-transactions';
import { ReasonSelect } from './reason-select';
import { customersApi } from '../../customers/api/customers.api';

export interface EditablePaymentRow {
  id: string;
  /** Stored negative — the gross received amount is `Math.abs(amount)`. */
  amount: number;
  description?: string | null;
  /** Optimistic-lock token: the exact ISO string the row was loaded with. */
  updatedAt: string;
  customer?: { id?: string; name?: string } | null;
}

interface EditPaymentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: EditablePaymentRow | null;
}

export function EditPaymentForm({ open, onOpenChange, transaction }: EditPaymentFormProps) {
  const { mutate: editPayment, isPending } = useEditPayment();

  const gross = transaction ? Math.abs(Number(transaction.amount)) : 0;
  const customerId = transaction?.customer?.id;

  const { data: customerData } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => customersApi.getOne(customerId as string).then((r) => r.data),
    enabled: open && !!customerId,
  });
  const balance = Number(
    (customerData as { financialBalance?: number } | undefined)?.financialBalance ?? 0,
  );

  const {
    register, handleSubmit, reset, watch, setValue,
    formState: { errors },
  } = useForm<EditPaymentInput>({
    resolver: zodResolver(editPaymentSchema),
    defaultValues: { amount: 0, description: '', reason: undefined, reasonNote: '' },
  });

  // Re-seed the form whenever a different row is opened.
  useEffect(() => {
    if (open && transaction) {
      reset({
        amount: Math.abs(Number(transaction.amount)),
        description: transaction.description ?? '',
        reason: undefined,
        reasonNote: '',
      });
    }
  }, [open, transaction, reset]);

  const watchedAmount = watch('amount', 0);
  const watchedReason = watch('reason');
  const watchedNote = watch('reasonNote') ?? '';

  const onSubmit = (values: EditPaymentInput) => {
    if (!transaction) return;
    editPayment(
      {
        id: transaction.id,
        data: {
          amount: values.amount,
          description: values.description,
          reason: values.reason,
          reasonNote: values.reason === 'OTHER' ? values.reasonNote : undefined,
          // Pass the token through verbatim — never reformat / re-derive.
          expectedUpdatedAt: transaction.updatedAt,
        },
      },
      { onSuccess: () => { reset(); onOpenChange(false); } },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md bg-background/95 backdrop-blur-xl border-l border-border/50 overflow-y-auto">
        <SheetHeader className="pb-6 border-b">
          <SheetTitle className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-primary" />
            Edit Payment
          </SheetTitle>
          <SheetDescription>
            Correct the amount or description of this manually-recorded payment
            {transaction?.customer?.name ? ` for ${transaction.customer.name}` : ''}. The
            customer's balance is adjusted by the difference and the change is written to
            the audit log.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-8">
          <div className="rounded-xl bg-accent/20 border border-border/40 p-3 flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Originally recorded</span>
            <span className="text-lg font-black font-mono text-foreground dark:text-white">
              ₨{gross.toLocaleString()}
            </span>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Payment Amount (₨)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₨</span>
              <Input
                type="number"
                step="0.01"
                min={0.01}
                placeholder="0.00"
                className="pl-9 bg-accent/30 border-border/50 h-12 text-lg font-black focus:border-primary/50 transition-all font-mono"
                {...register('amount', { valueAsNumber: true })}
              />
            </div>
            {errors.amount && <p className="text-xs font-medium text-destructive">{errors.amount.message}</p>}
            {/* Soft, non-blocking hint — overpayment is valid and becomes credit. */}
            {balance > 0 && watchedAmount > balance && (
              <p className="text-xs text-muted-foreground font-medium">
                Larger than the current balance of ₨{balance.toLocaleString()} — the extra becomes customer credit.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-3 w-3" /> Description / Reference
            </Label>
            <Input
              placeholder="e.g. Received via JazzCash, Cash on Delivery"
              className="bg-accent/30 border-border/50 h-11 focus:border-primary/50 transition-all"
              {...register('description')}
            />
          </div>

          <ReasonSelect
            value={watchedReason}
            onChange={(v) => setValue('reason', v, { shouldValidate: true })}
            note={watchedNote}
            onNoteChange={(v) => setValue('reasonNote', v, { shouldValidate: true })}
            reasonError={errors.reason?.message}
            noteError={errors.reasonNote?.message}
            disabled={isPending}
          />

          <SheetFooter className="pt-6 border-t gap-3 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" className="min-w-[140px] shadow-lg shadow-primary/20" disabled={isPending}>
              {isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
