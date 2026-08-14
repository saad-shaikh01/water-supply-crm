'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { expenseSchema, type ExpenseInput } from '../schemas';
import { useCreateExpense, useCreateSheetExpense, useUpdateExpense } from '../hooks/use-expenses';
import { useAllVans } from '../../vans/hooks/use-vans';

const CATEGORIES = [
  { value: 'LUNCH_EXPENSE_EMPLOYEE', label: 'Lunch Exp Employee' },
  { value: 'ADVANCE_SALARY_EMPLOYEE', label: 'Adv Salary Employee' },
  { value: 'VEHICLE_MAINTENANCE', label: 'Vehicle Maintenance' },
  { value: 'FUEL_EXPENSE', label: 'Fuel Exp' },
  { value: 'OTHER', label: 'Others' },
] as const;

interface ExpenseFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: Record<string, unknown> | null;
  dailySheetId?: string;
  defaultVanId?: string;
  onAfterSuccess?: () => void;
}

export function ExpenseForm({ open, onOpenChange, expense, dailySheetId, defaultVanId, onAfterSuccess }: ExpenseFormProps) {
  const isEdit = !!expense?.id;
  const { mutate: create, isPending: isCreating } = useCreateExpense();
  // Sheet-scoped variant — also invalidates the Daily Sheet's own query
  // (['sheets', dailySheetId]) so its Trip Expenses stat + expense list
  // reflect a new entry immediately, instead of only the general Expenses
  // list. Only used when this form was opened from a Daily Sheet.
  const { mutate: createForSheet, isPending: isCreatingForSheet } = useCreateSheetExpense(dailySheetId ?? '');
  const { mutate: update, isPending: isUpdating } = useUpdateExpense();
  const isPending = isCreating || isCreatingForSheet || isUpdating;
  const { data: vansData } = useAllVans();
  const vans = ((vansData as any)?.data ?? []) as Array<{ id: string; plateNumber: string; isActive: boolean }>;
  const activeVans = vans.filter((v) => v.isActive !== false);

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<ExpenseInput>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      category: 'FUEL_EXPENSE',
      date: new Date().toISOString().slice(0, 10),
    },
  });

  useEffect(() => {
    if (open && expense) {
      reset({
        amount: Number(expense.amount ?? 0),
        category: (expense.category as any) ?? 'FUEL_EXPENSE',
        description: String(expense.description ?? ''),
        date: expense.date ? String(expense.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
        vanId: expense.vanId ? String(expense.vanId) : undefined,
      });
    } else if (open && !expense && defaultVanId) {
      reset({
        category: 'FUEL_EXPENSE',
        date: new Date().toISOString().slice(0, 10),
        vanId: defaultVanId,
      });
    } else if (!open) {
      reset({ category: 'FUEL_EXPENSE', date: new Date().toISOString().slice(0, 10) });
    }
  }, [open, expense, reset, defaultVanId]);

  const onSubmit = (data: ExpenseInput) => {
    if (isEdit) {
      update({ id: String(expense!.id), data }, { onSuccess: () => { onOpenChange(false); onAfterSuccess?.(); } });
    } else if (dailySheetId) {
      createForSheet(
        { ...data, dailySheetId },
        { onSuccess: () => { onOpenChange(false); onAfterSuccess?.(); } },
      );
    } else {
      create(data, { onSuccess: () => { onOpenChange(false); onAfterSuccess?.(); } });
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
            <Label>Van (Optional)</Label>
            <Select value={watch('vanId') ?? 'none'} onValueChange={(v) => setValue('vanId', v === 'none' ? undefined : v)}>
              <SelectTrigger><SelectValue placeholder="No van" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No van</SelectItem>
                {activeVans.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.plateNumber}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
