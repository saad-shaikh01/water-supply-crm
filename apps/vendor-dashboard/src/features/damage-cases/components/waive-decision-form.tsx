'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from '@water-supply-crm/ui';
import { toast } from 'sonner';
import { useWaiveCase } from '../hooks/use-damage-cases';
import type { WriteOffCategory } from '../api/damage-cases.api';
import { useAuthStore } from '../../../store/auth.store';

const WRITE_OFF_OPTIONS: { value: WriteOffCategory; label: string }[] = [
  { value: 'CUSTOMER_NEGLIGENCE', label: 'Customer Negligence' },
  { value: 'NORMAL_WEAR', label: 'Normal Wear' },
  { value: 'TRANSIT_ACCIDENT', label: 'Transit Accident' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

interface WaiveCaseFormProps {
  caseId: string;
  version: number;
  onSuccess: () => void;
}

export function WaiveCaseForm({ caseId, version, onSuccess }: WaiveCaseFormProps) {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [writeOffCategory, setWriteOffCategory] = useState<WriteOffCategory>('NORMAL_WEAR');
  const [reviewNote, setReviewNote] = useState('');

  const { mutate: waiveCase, isPending } = useWaiveCase();

  // Only render for VENDOR_ADMIN or SUPER_ADMIN
  if (!user || (user.role !== 'VENDOR_ADMIN' && user.role !== 'SUPER_ADMIN')) {
    return null;
  }

  const handleSubmit = () => {
    waiveCase(
      {
        id: caseId,
        dto: {
          writeOffCategory,
          reviewNote: reviewNote.trim() || undefined,
          version,
        },
      },
      {
        onSuccess: () => {
          toast.success('Charge waived');
          setOpen(false);
          setWriteOffCategory('NORMAL_WEAR');
          setReviewNote('');
          onSuccess();
        },
      },
    );
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setWriteOffCategory('NORMAL_WEAR');
      setReviewNote('');
    }
    setOpen(v);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="rounded-xl font-bold gap-2 border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
      >
        Waive Charge
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-black text-xl">Waive Charge</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
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
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Waive Reason (optional)
              </Label>
              <Textarea
                placeholder="Explain why the charge is being waived..."
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
              onClick={handleSubmit}
              disabled={isPending}
              className="rounded-xl font-bold bg-amber-500 hover:bg-amber-600 text-white"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirm Waive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
