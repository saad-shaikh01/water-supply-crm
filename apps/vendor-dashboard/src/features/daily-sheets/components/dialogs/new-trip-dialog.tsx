'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { Package, Loader2 } from 'lucide-react';
import { useCreateLoad } from '../../hooks/use-daily-sheets';

interface NewTripDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
  tripNumber: number;
  defaultFilled: number;
}

export function NewTripDialog({ open, onClose, sheetId, tripNumber, defaultFilled }: NewTripDialogProps) {
  const { mutate: createLoad, isPending } = useCreateLoad(sheetId);
  const [filled, setFilled] = useState(defaultFilled);

  useEffect(() => {
    if (open) setFilled(defaultFilled);
  }, [open, defaultFilled]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Start Load-Out
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Trip {tripNumber} — Filled Bottles Dispatched
            </Label>
            <Input
              type="number"
              min={1}
              value={filled}
              onChange={(e) => setFilled(Number(e.target.value))}
              className="h-14 text-3xl font-black font-mono text-center"
            />
            <p className="text-[11px] text-muted-foreground">Total filled bottles loaded into the van for this trip.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => createLoad({ loadedFilled: filled }, { onSuccess: onClose })}
            disabled={isPending || filled < 1}
            className="rounded-xl font-bold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Confirm Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
