'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
  Button, Input, Label, Textarea,
} from '@water-supply-crm/ui';
import { Pencil } from 'lucide-react';
import { editCostSchema, type EditCostInput } from '../schemas';
import { useEditProductCost } from '../hooks/use-product-costs';
import type { ProductCost } from '../api/product-costs.api';

/**
 * Controlled Edit (design doc §4.4/§7.3) — `costPerUnit` only, always with a
 * mandatory reason. Only ever rendered by the parent dialog for a row it has
 * chosen to show the action on; this form still confirms before submit since
 * it mutates financial history (same caution level as Void).
 */
interface EditCostFormProps {
  row: ProductCost | null;
  productId: string;
  onOpenChange: (open: boolean) => void;
}

export function EditCostForm({ row, productId, onOpenChange }: EditCostFormProps) {
  const { mutate: edit, isPending } = useEditProductCost();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<EditCostInput>({
    resolver: zodResolver(editCostSchema),
    defaultValues: { costPerUnit: undefined, note: '' },
  });

  useEffect(() => {
    if (row) reset({ costPerUnit: row.costPerUnit, note: '' });
  }, [row, reset]);

  if (!row) return null;

  const onSubmit = (data: EditCostInput) => {
    edit(
      { id: row.id, productId, data: { costPerUnit: data.costPerUnit, note: data.note } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            Edit Cost
          </DialogTitle>
          <DialogDescription>
            Correcting the value for the row effective {new Date(row.effectiveFrom).toLocaleDateString(undefined, {
              day: 'numeric', month: 'short', year: 'numeric',
            })}. Only allowed because zero deliveries have been recorded in this row&apos;s range — the date boundaries
            themselves can never be edited.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Cost per Unit (₨)</Label>
            <Input
              type="number"
              step="0.01"
              min={0.01}
              className="h-11 font-mono font-bold"
              {...register('costPerUnit', { valueAsNumber: true })}
            />
            {errors.costPerUnit && <p className="text-xs font-medium text-destructive">{errors.costPerUnit.message}</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              placeholder="Why is this being corrected? (e.g. data-entry typo)"
              className="rounded-xl min-h-20"
              {...register('note')}
            />
            {errors.note && <p className="text-xs font-medium text-destructive">{errors.note.message}</p>}
          </div>

          <DialogFooter className="pt-2 gap-3 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" className="min-w-[120px] font-bold rounded-xl" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save Correction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
