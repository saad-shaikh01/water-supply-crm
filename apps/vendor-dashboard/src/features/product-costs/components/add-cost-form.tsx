'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
  Button, Input, Label, Textarea,
} from '@water-supply-crm/ui';
import { PlusCircle, AlertTriangle, History } from 'lucide-react';
import { addCostSchema, type AddCostInput } from '../schemas';
import { useCreateProductCost } from '../hooks/use-product-costs';
import type { ProductCost, ProductCostKind } from '../api/product-costs.api';

/**
 * Add a cost row (design doc §4.1/§7.3). `effectiveFrom` is deliberately NOT
 * defaulted to today — backdating is a first-class, expected action here, not
 * an edge case, so the admin must consciously pick the date.
 *
 * `note` is optional at the schema layer, but this form determines — from the
 * history already loaded by the parent dialog — whether the chosen
 * `effectiveFrom` would trim an existing covering row (§4.1 step 4). A trim
 * alone does not require a note: the backend's rule (2026-09-15 polish) is
 * narrower — a note is mandatory only when the trim is a TRUE backdated
 * correction, i.e. `effectiveFrom` is before today. A routine forward-dated
 * rate change (today or later) that happens to close out the currently-open
 * row needs no note. `isBackdated` below mirrors the backend's own
 * `isBackdated` check (UTC start-of-day) exactly, so client and server never
 * disagree about which case requires a reason.
 */

function findCoveringRow(history: ProductCost[], effectiveFromIso: string): ProductCost | null {
  if (!effectiveFromIso) return null;
  const d = new Date(effectiveFromIso).getTime();
  if (Number.isNaN(d)) return null;
  const nonVoided = history.filter((r) => !r.voidedAt);
  return (
    nonVoided.find((r) => {
      const from = new Date(r.effectiveFrom).getTime();
      const to = r.effectiveTo ? new Date(r.effectiveTo).getTime() : null;
      return from <= d && (to === null || to >= d);
    }) ?? null
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

interface AddCostFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName?: string;
  /** Which cost stream this Add targets (2026-09-22) — BOTTLE or CAP; each has its own
   *  independent effective-dated timeline, so the "covering row" check below only
   *  ever considers `history` for this one kind (the parent dialog already scopes it). */
  kind: ProductCostKind;
  /** The product's already-loaded history (from the parent Cost History dialog) — used
   *  to determine client-side whether this insert would backdate into an existing range. */
  history: ProductCost[];
}

export function AddCostForm({ open, onOpenChange, productId, productName, kind, history }: AddCostFormProps) {
  const { mutate: create, isPending } = useCreateProductCost();

  const { register, handleSubmit, reset, watch, setError, clearErrors, formState: { errors } } = useForm<AddCostInput>({
    resolver: zodResolver(addCostSchema),
    defaultValues: { costPerUnit: undefined, effectiveFrom: '', note: '', invoiceRef: '' },
  });

  useEffect(() => {
    if (!open) reset({ costPerUnit: undefined, effectiveFrom: '', note: '', invoiceRef: '' });
  }, [open, reset]);

  const effectiveFrom = watch('effectiveFrom');

  const covering = useMemo(() => findCoveringRow(history, effectiveFrom), [history, effectiveFrom]);
  const coveringDateIso = covering?.effectiveFrom.slice(0, 10);
  const isDuplicate = !!covering && coveringDateIso === effectiveFrom;
  // Any trim (forward or backdated) — shown as an informational note that a
  // row will be split, regardless of whether a reason is mandatory for it.
  const willTrim = !!covering && !isDuplicate;
  // Mandatory-note case: a trim AND the date is genuinely in the past (UTC
  // start-of-day, matching the backend's `isBackdated` check exactly).
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const isBackdatedCorrection = willTrim && effectiveFrom < todayIso;

  const onSubmit = (data: AddCostInput) => {
    if (isDuplicate) return; // belt-and-suspenders — submit button is already disabled
    const note = data.note?.trim();
    if (isBackdatedCorrection && !note) {
      setError('note', { message: 'A note is required — this date is backdated into an existing cost row, so this will split it.' });
      return;
    }
    clearErrors('note');
    create(
      {
        productId,
        kind,
        costPerUnit: data.costPerUnit,
        effectiveFrom: data.effectiveFrom,
        note: note || undefined,
        invoiceRef: data.invoiceRef?.trim() || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-primary" />
            Add {kind === 'CAP' ? 'Cap' : 'Bottle'} Cost
          </DialogTitle>
          <DialogDescription>
            {productName
              ? `New ${kind === 'CAP' ? 'cap' : 'plant bottle'} cost rate for ${productName}.`
              : `New ${kind === 'CAP' ? 'cap' : 'plant bottle'} cost rate.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Cost per Unit (₨)</Label>
            <Input
              type="number"
              step="0.01"
              min={0.01}
              placeholder="0.00"
              className="h-11 font-mono font-bold"
              {...register('costPerUnit', { valueAsNumber: true })}
            />
            {errors.costPerUnit && <p className="text-xs font-medium text-destructive">{errors.costPerUnit.message}</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Effective From</Label>
            <Input type="date" className="h-11" {...register('effectiveFrom')} />
            {errors.effectiveFrom && <p className="text-xs font-medium text-destructive">{errors.effectiveFrom.message}</p>}

            {isDuplicate && covering && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  A cost row already exists effective {formatDate(covering.effectiveFrom)}. Void that entry and re-add it with
                  the corrected value instead of adding a second one on the same date.
                </span>
              </div>
            )}
            {willTrim && covering && (
              <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-500/10 rounded-lg px-3 py-2">
                <History className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  This falls inside the row currently running from {formatDate(covering.effectiveFrom)}
                  {covering.effectiveTo ? ` to ${formatDate(covering.effectiveTo)}` : ' onward'} — that row will be trimmed to
                  end the day before.
                  {isBackdatedCorrection
                    ? ' Since this date is in the past, a note is required to explain the correction.'
                    : ' This is a routine forward-dated rate change, so no note is required.'}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">
              Note {isBackdatedCorrection && <span className="text-destructive">*</span>}
            </Label>
            <Textarea
              placeholder={isBackdatedCorrection ? 'Required — why is this backdated correction happening?' : 'Optional context, e.g. plant notice reference'}
              className="rounded-xl min-h-20"
              {...register('note')}
            />
            {errors.note && <p className="text-xs font-medium text-destructive">{errors.note.message}</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Invoice Ref (optional)</Label>
            <Input placeholder="e.g. invoice #4521" className="h-11" {...register('invoiceRef')} />
            {errors.invoiceRef && <p className="text-xs font-medium text-destructive">{errors.invoiceRef.message}</p>}
          </div>

          <DialogFooter className="pt-2 gap-3 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" className="min-w-[120px] font-bold rounded-xl" disabled={isPending || isDuplicate}>
              {isPending ? 'Saving…' : 'Add Cost'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
