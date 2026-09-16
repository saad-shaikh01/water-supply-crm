'use client';

import { useEffect, useState } from 'react';
import { PiggyBank } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { useAllVans } from '../../vans/hooks/use-vans';
import { useAddCashIn } from '../hooks/use-van-cash-ledger';

interface AddCashInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Records a manual cash-in — cash that entered the ledger from outside the
 * normal driver-handover flow. Van is optional: pick one to anchor the entry
 * to that van's own balance, or leave it as "No van (office-wide)" for a
 * general entry that only shows up in the vendor-wide "All Vans" view. Used
 * both for a one-time historical balance backfill and any later ad hoc cash
 * injection (owner topping up office cash, etc).
 */
export function AddCashInDialog({ open, onOpenChange }: AddCashInDialogProps) {
  const { data, isLoading } = useAllVans();
  const addCashIn = useAddCashIn();

  const [vanId, setVanId] = useState('none');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setVanId('none');
      setAmount('');
      setDate(todayIso());
      setNote('');
    }
  }, [open]);

  const vans = data?.data ?? [];
  const parsedAmount = Number(amount);
  const canSubmit = amount !== '' && !Number.isNaN(parsedAmount) && !!date && note.trim() !== '';

  const handleSubmit = () => {
    if (!canSubmit) return;
    addCashIn.mutate(
      {
        vanId: vanId === 'none' ? undefined : vanId,
        openingBalance: parsedAmount,
        openingDate: date,
        note: note.trim(),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <PiggyBank className="h-5 w-5 text-primary" />
            Add Cash In
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Van (Optional)
            </Label>
            <Select value={vanId} onValueChange={setVanId} disabled={isLoading}>
              <SelectTrigger className="h-10 rounded-xl">
                <SelectValue placeholder={isLoading ? 'Loading vans…' : 'Select a van'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No van (office-wide)</SelectItem>
                {vans.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.plateNumber}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Amount <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-10 rounded-xl"
              placeholder="0.00"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Date <span className="text-destructive">*</span>
            </Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-10 rounded-xl"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Note <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-xl"
              placeholder="e.g. Opening balance carried over from old records, or Owner added cash to office"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || addCashIn.isPending}
            className="rounded-xl font-bold"
          >
            {addCashIn.isPending ? 'Saving…' : 'Add Cash In'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
