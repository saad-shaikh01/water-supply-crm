'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useCheckinLoad, useCorrectClosedTrip } from '../../hooks/use-daily-sheets';

interface CheckinDialogProps {
  /** The load id that is open, or null when closed */
  open: string | null;
  onClose: () => void;
  sheetId: string;
  trip?: { loadedFilled: number };
  suggestedValues?: { returnedFilled: number; collectedEmpty: number };
  /** Trip Edit-Unlock: editing an already-checked-in trip (within an active
   * unlock window) instead of a fresh check-in — pre-fills from the trip's
   * REAL recorded values (not system-suggested ones) and submits with
   * forceResubmit: true on the same checkin endpoint. */
  mode?: 'checkin' | 'edit';
  editValues?: { returnedFilled: number; collectedEmpty: number; damagedOnVan: number; leakedOnVan: number };
  /** Post-Close Trip Correction: when true AND mode==='edit', this dialog
   * targets the dedicated closed-sheet correction endpoint (mandatory
   * free-text reason, signed-delta apply) instead of the normal checkin
   * edit. No effect on a fresh check-in. */
  isClosed?: boolean;
}

interface CheckinForm {
  returnedFilled: number | '';
  collectedEmpty: number | '';
  damagedOnVan: number | '';
  leakedOnVan: number | '';
}

// Returned/empty are pre-filled from system-calculated trip figures (derived
// from the completed delivery items) so the salesman just verifies them
// instead of recounting from scratch — still fully editable. Damaged/leaked
// have no computable source (physical van inspection only), so they always
// start empty.
const buildInitialForm = (
  suggestedValues?: { returnedFilled: number; collectedEmpty: number },
  editValues?: { returnedFilled: number; collectedEmpty: number; damagedOnVan: number; leakedOnVan: number },
): CheckinForm => {
  if (editValues) {
    return {
      returnedFilled: editValues.returnedFilled,
      collectedEmpty: editValues.collectedEmpty,
      damagedOnVan: editValues.damagedOnVan,
      leakedOnVan: editValues.leakedOnVan,
    };
  }
  return {
    returnedFilled: suggestedValues?.returnedFilled ?? '',
    collectedEmpty: suggestedValues?.collectedEmpty ?? '',
    damagedOnVan: '',
    leakedOnVan: '',
  };
};

export function CheckinDialog({ open, onClose, sheetId, trip, suggestedValues, mode = 'checkin', editValues, isClosed = false }: CheckinDialogProps) {
  const { mutate: checkinLoad, isPending } = useCheckinLoad(sheetId);
  const { mutate: correctClosedTrip, isPending: isCorrecting } = useCorrectClosedTrip(sheetId);
  const [form, setForm] = useState<CheckinForm>(buildInitialForm(suggestedValues, editValues));
  const [correctionNote, setCorrectionNote] = useState('');
  const isEdit = mode === 'edit';
  // Closed-sheet correction path — dedicated endpoint + mandatory reason.
  const isClosedCorrection = isEdit && isClosed;
  const noteValid = correctionNote.trim().length >= 3;
  const busy = isPending || isCorrecting;

  // Sync form with suggested/edit values each time the dialog opens
  useEffect(() => {
    if (open) {
      setForm(buildInitialForm(suggestedValues, editValues));
      setCorrectionNote('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpen = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
      setForm(buildInitialForm(suggestedValues, editValues));
      setCorrectionNote('');
    }
  };

  const normalized = {
    returnedFilled: form.returnedFilled === '' ? 0 : form.returnedFilled,
    collectedEmpty: form.collectedEmpty === '' ? 0 : form.collectedEmpty,
    damagedOnVan: form.damagedOnVan === '' ? 0 : form.damagedOnVan,
    leakedOnVan: form.leakedOnVan === '' ? 0 : form.leakedOnVan,
  };

  const handleSubmit = () => {
    const loadId = open;
    if (!loadId) return;
    if (isClosedCorrection) {
      if (!noteValid) return;
      correctClosedTrip(
        { loadId, ...normalized, correctionNote: correctionNote.trim() },
        { onSuccess: onClose },
      );
      return;
    }
    checkinLoad(
      { loadId, data: { ...normalized, ...(isEdit ? { forceResubmit: true } : {}) } },
      { onSuccess: onClose },
    );
  };

  const title = isClosedCorrection
    ? 'Correct Closed-Sheet Trip Check-In'
    : isEdit
      ? 'Edit Trip Check-In'
      : 'Trip Check-In';

  return (
    <Dialog open={!!open} onOpenChange={handleOpen}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {isClosedCorrection && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-400 font-medium leading-relaxed">
              This sheet is closed. This correction updates the trip&apos;s physical counts and the
              live reconciliation — the close-time cash figure and any discrepancy cases stay as
              they were.
            </p>
          </div>
        )}

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
        </div>

        {isClosedCorrection && (
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Reason for correction <span className="text-destructive">*</span>
            </Label>
            <textarea
              value={correctionNote}
              onChange={(e) => setCorrectionNote(e.target.value)}
              placeholder="Explain why these counts are being corrected…"
              rows={3}
              className="w-full rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500/30 resize-none placeholder:text-muted-foreground"
            />
            {!noteValid && (
              <p className="text-[11px] text-muted-foreground">Enter at least 3 characters.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={busy || (isClosedCorrection && !noteValid)}
            className="rounded-xl font-bold"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {isClosedCorrection ? 'Save Correction' : isEdit ? 'Save Changes' : 'Confirm Check-In'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
