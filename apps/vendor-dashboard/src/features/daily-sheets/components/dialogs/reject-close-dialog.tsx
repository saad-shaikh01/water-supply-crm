'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Label, Textarea,
} from '@water-supply-crm/ui';
import { Loader2, XCircle } from 'lucide-react';
import { useRejectCloseSheet } from '../../hooks/use-daily-sheets';

interface RejectCloseDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
}

/**
 * Soft Close (Amendment R9): Staff/Admin sends a Driver/Salesman's close
 * request back for correction. Reopens the sheet (isClosed=false) — no
 * financial data was ever committed (approveClose never ran), so there's
 * nothing to reverse.
 */
export function RejectCloseDialog({ open, onClose, sheetId }: RejectCloseDialogProps) {
  const { mutate: rejectClose, isPending } = useRejectCloseSheet(sheetId);
  const [reason, setReason] = useState('');

  const handleClose = () => { setReason(''); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" />
            Reject Close Request
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            The sheet will reopen for the driver/salesman to fix and resubmit. Explain what needs to be corrected.
          </p>
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest">Reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Cash short by ₨500 — please recount and re-enter"
              className="min-h-[90px] rounded-xl"
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isPending}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={isPending || !reason.trim()}
            onClick={() => rejectClose({ reason: reason.trim() }, { onSuccess: handleClose })}
            className="rounded-xl font-bold min-w-[120px]"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Reject &amp; Reopen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
