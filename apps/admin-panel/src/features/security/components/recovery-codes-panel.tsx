'use client';

import { useState } from 'react';
import { Button, Label } from '@water-supply-crm/ui';
import { toast } from 'sonner';

interface Props {
  codes: string[];
  /** Label of the confirm button shown once the "I saved them" box is checked. */
  continueLabel?: string;
  onContinue: () => void;
}

/** Recovery codes are shown exactly once: copy/download, then an "I saved them" gate before continuing. */
export function RecoveryCodesPanel({ codes, continueLabel = 'Continue', onContinue }: Props) {
  const [saved, setSaved] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('Recovery codes copied');
    } catch {
      toast.error('Could not copy. Select and copy the codes manually.');
    }
  };

  const download = () => {
    const blob = new Blob([`WaterCRM Admin recovery codes\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'watercrm-admin-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4" data-testid="recovery-codes-panel">
      <p className="text-sm text-muted-foreground">
        Save these recovery codes somewhere safe. Each can be used once if you lose your authenticator. They will not be shown again.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c} data-testid="recovery-code">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          Copy
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          Download
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <input id="codes-saved" type="checkbox" className="h-4 w-4" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <Label htmlFor="codes-saved">I saved them</Label>
      </div>
      <Button type="button" className="w-full" disabled={!saved} onClick={onContinue}>
        {continueLabel}
      </Button>
    </div>
  );
}
