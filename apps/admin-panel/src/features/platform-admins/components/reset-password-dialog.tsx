'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@water-supply-crm/ui';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  isPending?: boolean;
  onChoose: (mode: 'EMAIL' | 'TEMP') => void;
}

/** Two ways to reset another admin's password; either revokes all of their sessions. */
export function ResetPasswordDialog({ open, onOpenChange, name, isPending, onChoose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password for {name}?</DialogTitle>
          <DialogDescription>
            Their sessions are revoked immediately. Email them a reset link, or generate a temporary password to hand over (shown once).
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" disabled={isPending} onClick={() => onChoose('EMAIL')}>
            Email reset link
          </Button>
          <Button disabled={isPending} onClick={() => onChoose('TEMP')}>
            Generate temporary password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
