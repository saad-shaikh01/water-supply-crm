'use client';

import { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { useCreateFuelCard } from '../hooks/use-fuel-cards';

interface CreateFuelCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateFuelCardDialog({ open, onOpenChange }: CreateFuelCardDialogProps) {
  const createCard = useCreateFuelCard();
  const [name, setName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [issuer, setIssuer] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setCardNumber('');
      setIssuer('');
    }
  }, [open]);

  const canSubmit = name.trim().length >= 2;

  const handleSubmit = () => {
    if (!canSubmit) return;
    createCard.mutate(
      { name: name.trim(), cardNumber: cardNumber.trim() || undefined, issuer: issuer.trim() || undefined },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-orange-500" />
            Register Fuel Card
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Card Name <span className="text-destructive">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 rounded-xl"
              placeholder="e.g. PSO Fleet Card"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Issuer
              </Label>
              <Input
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                className="h-10 rounded-xl"
                placeholder="e.g. PSO, Shell"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                Card Number
              </Label>
              <Input
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                className="h-10 rounded-xl"
                placeholder="e.g. •••• 4521"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || createCard.isPending} className="rounded-xl font-bold">
            {createCard.isPending ? 'Registering…' : 'Register Card'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
