'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button, Textarea } from '@water-supply-crm/ui';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useOverrideCriticalCheck } from '../../hooks/use-vehicle-checks';

interface CriticalOverrideDialogProps {
  open: boolean;
  onClose: () => void;
  checkId: string;
  dailySheetId: string;
  failedItems: string[];
}

/**
 * The one Staff/Admin-only action this feature adds to trip start (plan doc
 * §6/§10 Rule 6) — acknowledging a critical checklist failure so the trip can
 * proceed despite it. Requires a reason, which is stored on the check row.
 */
export function CriticalOverrideDialog({ open, onClose, checkId, dailySheetId, failedItems }: CriticalOverrideDialogProps) {
  const [note, setNote] = useState('');
  const { mutate: overrideCritical, isPending } = useOverrideCriticalCheck();

  function handleSubmit() {
    if (!note.trim()) return;
    overrideCritical(
      { id: checkId, note, dailySheetId },
      {
        onSuccess: () => {
          onClose();
          setNote('');
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            Acknowledge Critical Issue
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
            <p className="text-sm font-semibold text-destructive">{failedItems.join(', ')}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Flagged on this morning&apos;s vehicle check. Explain why the trip may proceed anyway (e.g. mechanic
              inspected and cleared it, replacement van assigned).
            </p>
          </div>

          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason for proceeding…"
            className="rounded-xl min-h-24"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !note.trim()}
            className="rounded-xl font-bold bg-destructive hover:bg-destructive/90"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Acknowledge &amp; Allow Trip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
