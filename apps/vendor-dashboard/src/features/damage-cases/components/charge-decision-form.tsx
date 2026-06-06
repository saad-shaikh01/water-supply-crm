'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@water-supply-crm/ui';
import { toast } from 'sonner';
import { useChargeCase } from '../hooks/use-damage-cases';
import type { WriteOffCategory } from '../api/damage-cases.api';
import { useAuthStore } from '../../../store/auth.store';

const WRITE_OFF_OPTIONS: { value: WriteOffCategory; label: string }[] = [
  { value: 'CUSTOMER_NEGLIGENCE', label: 'Customer Negligence' },
  { value: 'NORMAL_WEAR', label: 'Normal Wear' },
  { value: 'TRANSIT_ACCIDENT', label: 'Transit Accident' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  CUSTOMER_NEGLIGENCE: 'Customer broke or lost the bottle.',
  NORMAL_WEAR: 'Bottle cracked due to age or regular use.',
  TRANSIT_ACCIDENT: 'Damage occurred during transport.',
  UNKNOWN: 'Cause could not be determined.',
};

interface ChargeCaseFormProps {
  caseId: string;
  version: number;
  hasPhotos: boolean;
  onSuccess: () => void;
}

export function ChargeCaseForm({ caseId, version, hasPhotos, onSuccess }: ChargeCaseFormProps) {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [chargeAmount, setChargeAmount] = useState('');
  const [writeOffCategory, setWriteOffCategory] = useState<WriteOffCategory>('CUSTOMER_NEGLIGENCE');
  const [reviewNote, setReviewNote] = useState('');

  const { mutate: chargeCase, isPending } = useChargeCase();

  // Only render for VENDOR_ADMIN or SUPER_ADMIN
  if (!user || (user.role !== 'VENDOR_ADMIN' && user.role !== 'SUPER_ADMIN')) {
    return null;
  }

  const handleSubmit = () => {
    const amount = parseFloat(chargeAmount);
    if (!amount || amount <= 0) {
      toast.error('Please enter a valid charge amount');
      return;
    }

    chargeCase(
      {
        id: caseId,
        dto: {
          chargeAmount: amount,
          writeOffCategory,
          reviewNote: reviewNote.trim() || undefined,
          version,
        },
      },
      {
        onSuccess: () => {
          toast.success('Customer charged successfully');
          setOpen(false);
          setChargeAmount('');
          setWriteOffCategory('CUSTOMER_NEGLIGENCE');
          setReviewNote('');
          onSuccess();
        },
      },
    );
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setChargeAmount('');
      setWriteOffCategory('CUSTOMER_NEGLIGENCE');
      setReviewNote('');
    }
    setOpen(v);
  };

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setOpen(true)}
        className="rounded-xl font-bold gap-2"
      >
        Charge Customer
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-black text-xl">Charge Customer</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {!hasPhotos && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                  No photos attached. Charge is blocked until at least one photo is uploaded.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Charge Amount (&#8360;)
              </Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="e.g. 500"
                value={chargeAmount}
                onChange={(e) => setChargeAmount(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Write-off Category
              </Label>
              <select
                value={writeOffCategory}
                onChange={(e) => setWriteOffCategory(e.target.value as WriteOffCategory)}
                className="w-full h-11 rounded-xl bg-background/50 border border-border/60 text-sm text-foreground dark:text-white px-3 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {WRITE_OFF_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-background text-foreground dark:text-white">
                    {opt.label}
                  </option>
                ))}
              </select>
              {CATEGORY_DESCRIPTIONS[writeOffCategory] && (
                <p className="text-xs text-muted-foreground">{CATEGORY_DESCRIPTIONS[writeOffCategory]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Review Note (optional)
              </Label>
              <Textarea
                placeholder="Add any notes about this charge decision..."
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleSubmit}
              disabled={isPending || !hasPhotos || !chargeAmount || parseFloat(chargeAmount) <= 0}
              className="rounded-xl font-bold"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirm Charge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
