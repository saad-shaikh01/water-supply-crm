'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@water-supply-crm/ui';
import { toast } from 'sonner';

interface Props {
  /** The temporary password, or null when closed. Held only in parent state and cleared on close. */
  password: string | null;
  who?: string;
  onClose: () => void;
}

/** Shows a generated temporary password exactly once. */
export function TempPasswordDialog({ password, who, onClose }: Props) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password ?? '');
      toast.success('Password copied');
    } catch {
      toast.error('Could not copy. Select and copy the password manually.');
    }
  };

  return (
    <Dialog open={password !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>
            Share this with {who ?? 'the administrator'} over a secure channel. It is shown only once, and they must change it at their first sign-in.
          </DialogDescription>
        </DialogHeader>
        <code data-testid="temp-password" className="block break-all rounded-md border bg-muted/40 p-3 font-mono text-sm">
          {password}
        </code>
        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            Copy
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
