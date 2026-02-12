'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { adjustmentSchema, type AdjustmentInput } from '../schemas';
import { useAddAdjustment } from '../hooks/use-transactions';

interface AdjustmentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
}

export function AdjustmentForm({ open, onOpenChange, customerId }: AdjustmentFormProps) {
  const { mutate: addAdjustment, isPending } = useAddAdjustment();

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<AdjustmentInput>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: { type: 'CREDIT' },
  });

  const onSubmit = (data: AdjustmentInput) => {
    addAdjustment({ customerId, data }, {
      onSuccess: () => { reset(); onOpenChange(false); },
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader><SheetTitle>Add Adjustment</SheetTitle></SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={watch('type')} onValueChange={(v) => setValue('type', v as 'CREDIT' | 'DEBIT')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CREDIT">Credit (add to balance)</SelectItem>
                <SelectItem value="DEBIT">Debit (deduct from balance)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Amount</Label>
            <Input type="number" step="0.01" placeholder="0.00" {...register('amount', { valueAsNumber: true })} />
            {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Input placeholder="Reason for adjustment" {...register('reason')} />
            {errors.reason && <p className="text-sm text-destructive">{errors.reason.message}</p>}
          </div>
          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending ? 'Saving...' : 'Add Adjustment'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
