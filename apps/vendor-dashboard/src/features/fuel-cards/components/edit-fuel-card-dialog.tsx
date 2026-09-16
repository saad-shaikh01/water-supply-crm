'use client';

import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { useUpdateFuelCard } from '../hooks/use-fuel-cards';
import type { FuelCard } from '../api/fuel-card.api';

interface EditFuelCardDialogProps {
  card: FuelCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditFuelCardDialog({ card, open, onOpenChange }: EditFuelCardDialogProps) {
  const updateCard = useUpdateFuelCard();
  const [name, setName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [issuer, setIssuer] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');

  useEffect(() => {
    if (open && card) {
      setName(card.name);
      setCardNumber(card.cardNumber ?? '');
      setIssuer(card.issuer ?? '');
      setOpeningBalance(String(card.openingBalance ?? 0));
    }
  }, [open, card]);

  const canSubmit = name.trim().length >= 2;

  const handleSubmit = () => {
    if (!card || !canSubmit) return;
    const parsedOpeningBalance = Number(openingBalance);
    updateCard.mutate(
      {
        id: card.id,
        data: {
          name: name.trim(),
          cardNumber: cardNumber.trim() || undefined,
          issuer: issuer.trim() || undefined,
          openingBalance: Number.isNaN(parsedOpeningBalance) ? undefined : parsedOpeningBalance,
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <Pencil className="h-5 w-5 text-orange-500" />
            Edit Fuel Card
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Card Name <span className="text-destructive">*</span>
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-10 rounded-xl" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Issuer</Label>
              <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} className="h-10 rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Card Number</Label>
              <Input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} className="h-10 rounded-xl" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Opening Balance
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              className="h-10 rounded-xl"
            />
            <p className="text-[10px] text-muted-foreground">
              Carry-forward baseline for cash already on this card. Correcting it does not affect Office Cash
              Ledger — use Top Up for new cash added to the card going forward.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || updateCard.isPending} className="rounded-xl font-bold">
            {updateCard.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
