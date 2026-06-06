'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { paymentSchema, type PaymentInput } from '../schemas';
import { useAddPayment } from '../hooks/use-transactions';
import { customersApi } from '../../customers/api/customers.api';
import { CreditCard, FileText } from 'lucide-react';

interface PaymentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
}

export function PaymentForm({ open, onOpenChange, customerId }: PaymentFormProps) {
  const { mutate: addPayment, isPending } = useAddPayment();

  const { data: customerData } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => customersApi.getOne(customerId).then((r) => r.data),
    enabled: !!customerId,
  });
  const balance = Number((customerData as any)?.financialBalance ?? 0);

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<PaymentInput>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { amount: 0, description: '' },
  });

  const watchedAmount = watch('amount', 0);

  useEffect(() => {
    if (balance > 0) reset({ amount: balance, description: '' });
  }, [balance]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = (data: PaymentInput) => {
    addPayment({ customerId, data }, {
      onSuccess: () => { reset(); onOpenChange(false); },
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md bg-background/95 backdrop-blur-xl border-l border-border/50">
        <SheetHeader className="pb-6 border-b">
          <SheetTitle className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-primary" />
            Record Payment
          </SheetTitle>
          <SheetDescription>
            Record a manual cash or bank payment received from the customer.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-8">
          {balance > 0 && (
            <div className="rounded-xl bg-primary/5 border border-primary/10 p-3 flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Outstanding Balance</span>
              <span className="text-lg font-black font-mono text-primary">₨{balance.toLocaleString()}</span>
            </div>
          )}
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
            {balance > 0 && watchedAmount > balance && (
              <p className="text-xs text-amber-500 font-medium">
                This exceeds the outstanding balance of ₨{balance.toLocaleString()} — customer will have a credit.
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

          <div className="p-4 rounded-xl bg-primary/5 border border-primary/10">
            <p className="text-[10px] text-primary font-bold uppercase tracking-widest">Important</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Recording this payment will immediately reduce the customer's outstanding balance. A WhatsApp notification will be queued automatically.
            </p>
          </div>

          <SheetFooter className="pt-6 border-t gap-3 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" className="min-w-[140px] shadow-lg shadow-primary/20" disabled={isPending}>
              {isPending ? 'Processing...' : 'Record Payment'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
