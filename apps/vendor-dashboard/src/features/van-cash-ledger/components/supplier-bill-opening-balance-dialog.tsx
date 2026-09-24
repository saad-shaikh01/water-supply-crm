'use client';

import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Textarea,
} from '@water-supply-crm/ui';
import { useSupplierBillOpeningBalance, useSetSupplierBillOpeningBalance } from '../hooks/use-van-cash-ledger';

interface SupplierBillOpeningBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Owner request 2026-09-25: a vendor who starts using the software mid-way
 * through their real business already owes the plant/caps supplier for
 * deliveries this system never saw. Without this, that debt is invisible to
 * `prevMonthPending` and a payment meant to settle it gets wrongly netted
 * against the current month's system-computed bill instead. Set once here at
 * onboarding (or correct later) — same payment waterfall then clears it first,
 * exactly like any other backlog (see SupplierBillService's class doc).
 */
export function SupplierBillOpeningBalanceDialog({ open, onOpenChange }: SupplierBillOpeningBalanceDialogProps) {
  const { data, isLoading } = useSupplierBillOpeningBalance(open);
  const setOpeningBalance = useSetSupplierBillOpeningBalance();

  const [plantAmount, setPlantAmount] = useState('');
  const [capsAmount, setCapsAmount] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open && data) {
      setPlantAmount(data.plantAmount ? String(data.plantAmount) : '');
      setCapsAmount(data.capsAmount ? String(data.capsAmount) : '');
      setNote(data.note ?? '');
    }
  }, [open, data]);

  const parsedPlant = Number(plantAmount || 0);
  const parsedCaps = Number(capsAmount || 0);
  const canSubmit =
    !Number.isNaN(parsedPlant) && parsedPlant >= 0 && !Number.isNaN(parsedCaps) && parsedCaps >= 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setOpeningBalance.mutate(
      { plantAmount: parsedPlant, capsAmount: parsedCaps, note: note.trim() || undefined },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Opening Balance
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-2">
          Amount already owed to the plant/caps supplier from BEFORE you started tracking deliveries in this
          software (e.g. last month&apos;s unpaid bill at go-live). Any payment recorded here clears this first.
        </p>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Plant Bill (Bottle Refill)
            </Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={plantAmount}
              onChange={(e) => setPlantAmount(e.target.value)}
              className="h-10 rounded-xl"
              placeholder="0.00"
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Caps Bill
            </Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={capsAmount}
              onChange={(e) => setCapsAmount(e.target.value)}
              className="h-10 rounded-xl"
              placeholder="0.00"
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Note (Optional)
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-xl"
              placeholder="e.g. Carried over from before we started using the software"
              rows={2}
              disabled={isLoading}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || isLoading || setOpeningBalance.isPending}
            className="rounded-xl font-bold"
          >
            {setOpeningBalance.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
