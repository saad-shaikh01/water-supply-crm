'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@water-supply-crm/ui';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Extra content (lists, reason field, errors) rendered above the confirmation input. */
  children?: ReactNode;
  /** The exact text that must be typed (e.g. the vendor slug, or "SUSPEND 3"). */
  phrase: string;
  confirmLabel: string;
  onConfirm: () => void;
  isPending?: boolean;
  /** Visual tone of the confirm button. */
  destructive?: boolean;
}

/** Confirmation that stays disabled until `phrase` is typed exactly. Typed text is cleared on close. */
export function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  phrase,
  confirmLabel,
  onConfirm,
  isPending,
  destructive = true,
}: Props) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const ok = typed.trim() === phrase;

  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
        {children}
        <div className="space-y-1.5">
          <Label htmlFor="typed-confirm-input">
            Type <code className="font-mono font-semibold">{phrase}</code> to confirm
          </Label>
          <Input id="typed-confirm-input" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={phrase} />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={!ok || isPending} onClick={onConfirm}>
            {isPending ? 'Please wait...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
