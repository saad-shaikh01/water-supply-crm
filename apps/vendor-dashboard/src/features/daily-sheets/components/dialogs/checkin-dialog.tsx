'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useCheckinLoad } from '../../hooks/use-daily-sheets';

interface CheckinDialogProps {
  /** The load id that is open, or null when closed */
  open: string | null;
  onClose: () => void;
  sheetId: string;
  trip?: { loadedFilled: number };
  suggestedValues?: { returnedFilled: number; collectedEmpty: number; cashHandedIn: number };
}

interface CheckinForm {
  returnedFilled: number | '';
  collectedEmpty: number | '';
  cashHandedIn: number;
  damagedOnVan: number | '';
  leakedOnVan: number | '';
}

// Returned/empty/cash are pre-filled from system-calculated trip figures
// (derived from the completed delivery items) so the salesman just verifies
// them instead of recounting from scratch — still fully editable. Damaged/
// leaked have no computable source (physical van inspection only), so they
// always start empty.
const buildInitialForm = (suggestedValues?: { returnedFilled: number; collectedEmpty: number; cashHandedIn: number }): CheckinForm => ({
  returnedFilled: suggestedValues?.returnedFilled ?? '',
  collectedEmpty: suggestedValues?.collectedEmpty ?? '',
  damagedOnVan: '',
  leakedOnVan: '',
  cashHandedIn: suggestedValues?.cashHandedIn ?? 0,
});

export function CheckinDialog({ open, onClose, sheetId, trip, suggestedValues }: CheckinDialogProps) {
  const { mutate: checkinLoad, isPending } = useCheckinLoad(sheetId);
  const [form, setForm] = useState<CheckinForm>(buildInitialForm(suggestedValues));

  // Sync form with suggested values each time the dialog opens
  useEffect(() => {
    if (open) {
      setForm(buildInitialForm(suggestedValues));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpen = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
      setForm(buildInitialForm(suggestedValues));
    }
  };

  return (
    <Dialog open={!!open} onOpenChange={handleOpen}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            Trip Check-In
          </DialogTitle>
        </DialogHeader>
        {trip && (
          <div className="rounded-xl bg-muted/30 border border-border/30 px-4 py-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground font-medium">Trip Loaded</span>
            <span className="font-black font-mono">{trip.loadedFilled} bottles</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest">Filled Returned</Label>
            <Input
              type="number"
              min={0}
              value={form.returnedFilled}
              placeholder="0"
              onChange={(e) => setForm((p) => ({ ...p, returnedFilled: e.target.value === '' ? '' : Number(e.target.value) }))}
              className="font-mono font-bold"
            />
          </div>
          {trip && Number(form.returnedFilled) > trip.loadedFilled && (
            <p className="text-xs text-amber-500 col-span-2 -mt-2">
              Returned count ({form.returnedFilled}) exceeds loaded count ({trip.loadedFilled}) — verify?
            </p>
          )}
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest">Empties Collected</Label>
            <Input
              type="number"
              min={0}
              value={form.collectedEmpty}
              placeholder="0"
              onChange={(e) => setForm((p) => ({ ...p, collectedEmpty: e.target.value === '' ? '' : Number(e.target.value) }))}
              className="font-mono font-bold"
            />
          </div>
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-orange-500">Damaged on Van</Label>
            <Input
              type="number"
              min={0}
              value={form.damagedOnVan}
              placeholder="0"
              onChange={(e) => setForm((p) => ({ ...p, damagedOnVan: e.target.value === '' ? '' : Number(e.target.value) }))}
              className="font-mono font-bold border-orange-500/30 focus-visible:ring-orange-500/30"
            />
          </div>
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-red-500">Leaked on Van</Label>
            <Input
              type="number"
              min={0}
              value={form.leakedOnVan}
              placeholder="0"
              onChange={(e) => setForm((p) => ({ ...p, leakedOnVan: e.target.value === '' ? '' : Number(e.target.value) }))}
              className="font-mono font-bold border-red-500/30 focus-visible:ring-red-500/30"
            />
          </div>
          <div className="col-span-2 space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest">Cash Handed In (₨)</Label>
            <Input
              type="number"
              min={0}
              value={form.cashHandedIn}
              onChange={(e) => setForm((p) => ({ ...p, cashHandedIn: Number(e.target.value) }))}
              className="h-14 text-2xl font-black font-mono text-center"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => checkinLoad({
              loadId: open!,
              data: {
                ...form,
                returnedFilled: form.returnedFilled === '' ? 0 : form.returnedFilled,
                collectedEmpty: form.collectedEmpty === '' ? 0 : form.collectedEmpty,
                damagedOnVan: form.damagedOnVan === '' ? 0 : form.damagedOnVan,
                leakedOnVan: form.leakedOnVan === '' ? 0 : form.leakedOnVan,
              },
            }, { onSuccess: onClose })}
            disabled={isPending}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Confirm Check-In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
