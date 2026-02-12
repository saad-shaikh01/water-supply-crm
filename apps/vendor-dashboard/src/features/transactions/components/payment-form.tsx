'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { paymentSchema, type PaymentInput } from '../schemas';
import { useAddPayment } from '../hooks/use-transactions';

interface PaymentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
}

export function PaymentForm({ open, onOpenChange, customerId }: PaymentFormProps) {
  const { mutate: addPayment, isPending } = useAddPayment();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PaymentInput>({
    resolver: zodResolver(paymentSchema),
  });

  const onSubmit = (data: PaymentInput) => {
    addPayment({ customerId, data }, {
      onSuccess: () => { reset(); onOpenChange(false); },
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader><SheetTitle>Record Payment</SheetTitle></SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label>Amount</Label>
            <Input type="number" step="0.01" min={0.01} placeholder="0.00" {...register('amount', { valueAsNumber: true })} />
            {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Input placeholder="Payment notes" {...register('notes')} />
          </div>
          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending ? 'Recording...' : 'Record Payment'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
