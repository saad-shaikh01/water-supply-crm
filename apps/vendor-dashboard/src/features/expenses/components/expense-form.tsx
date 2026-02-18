'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { expenseSchema, type ExpenseInput } from '../schemas';
import { useCreateExpense, useUpdateExpense } from '../hooks/use-expenses';

const CATEGORIES = [
  { value: 'FUEL', label: 'Fuel' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'SALARY', label: 'Salary' },
  { value: 'REPAIR', label: 'Repair' },
  { value: 'OTHER', label: 'Other' },
] as const;

interface ExpenseFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: Record<string, unknown> | null;
}

export function ExpenseForm({ open, onOpenChange, expense }: ExpenseFormProps) {
  const isEdit = !!expense?.id;
  const { mutate: create, isPending: isCreating } = useCreateExpense();
  const { mutate: update, isPending: isUpdating } = useUpdateExpense();
  const isPending = isCreating || isUpdating;

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<ExpenseInput>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      category: 'FUEL',
      date: new Date().toISOString().slice(0, 10),
    },
  });

  useEffect(() => {
    if (open && expense) {
      reset({
        amount: Number(expense.amount ?? 0),
        category: (expense.category as any) ?? 'FUEL',
        description: String(expense.description ?? ''),
        date: expense.date ? String(expense.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
        vanId: expense.vanId ? String(expense.vanId) : undefined,
      });
    } else if (!open) {
      reset({ category: 'FUEL', date: new Date().toISOString().slice(0, 10) });
    }
  }, [open, expense, reset]);

  const onSubmit = (data: ExpenseInput) => {
    if (isEdit) {
      update({ id: String(expense!.id), data }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(data, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit Expense' : 'Record Expense'}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label>Amount (₨)</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="0.00"
              {...register('amount', { valueAsNumber: true })}
              className="h-12 text-xl font-black font-mono"
            />
            {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={watch('category')} onValueChange={(v) => setValue('category', v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" {...register('date')} />
              {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Input placeholder="Optional notes..." {...register('description')} />
          </div>

          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : isEdit ? 'Update' : 'Record'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
