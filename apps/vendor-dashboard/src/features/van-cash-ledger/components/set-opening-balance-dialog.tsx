'use client';

import { useEffect, useState } from 'react';
import { PiggyBank } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { useAllVans } from '../../vans/hooks/use-vans';
import { useSetOpeningBalance } from '../hooks/use-van-cash-ledger';

interface SetOpeningBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function SetOpeningBalanceDialog({ open, onOpenChange }: SetOpeningBalanceDialogProps) {
  const { data, isLoading } = useAllVans();
  const setOpeningBalance = useSetOpeningBalance();

  const [vanId, setVanId] = useState('');
  const [openingBalance, setOpeningBalanceValue] = useState('');
  const [openingDate, setOpeningDate] = useState(todayIso());

  useEffect(() => {
    if (open) {
      setVanId('');
      setOpeningBalanceValue('');
      setOpeningDate(todayIso());
    }
  }, [open]);

  const vans = data?.data ?? [];
  const parsedAmount = Number(openingBalance);
  const canSubmit = !!vanId && openingBalance !== '' && !Number.isNaN(parsedAmount) && !!openingDate;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setOpeningBalance.mutate(
      { vanId, openingBalance: parsedAmount, openingDate },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <PiggyBank className="h-5 w-5 text-primary" />
            Set Opening Balance
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Van <span className="text-destructive">*</span>
            </Label>
            <Select value={vanId} onValueChange={setVanId} disabled={isLoading}>
              <SelectTrigger className="h-10 rounded-xl">
                <SelectValue placeholder={isLoading ? 'Loading vans…' : 'Select a van'} />
              </SelectTrigger>
              <SelectContent>
                {vans.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.plateNumber}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Opening Balance <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalanceValue(e.target.value)}
              className="h-10 rounded-xl"
              placeholder="0.00"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Opening Date <span className="text-destructive">*</span>
            </Label>
            <Input
              type="date"
              value={openingDate}
              onChange={(e) => setOpeningDate(e.target.value)}
              className="h-10 rounded-xl"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || setOpeningBalance.isPending}
            className="rounded-xl font-bold"
          >
            {setOpeningBalance.isPending ? 'Saving…' : 'Set Balance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
