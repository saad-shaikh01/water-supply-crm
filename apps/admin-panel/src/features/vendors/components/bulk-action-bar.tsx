'use client';

import { Button } from '@water-supply-crm/ui';
import { Pause, Play, X } from 'lucide-react';

interface Props {
  count: number;
  onSuspend: () => void;
  onReactivate: () => void;
  onClear: () => void;
}

/** Bulk-safe: ONLY suspend / reactivate. Delete, wipe and password reset are deliberately never offered in bulk. */
export function BulkActionBar({ count, onSuspend, onReactivate, onClear }: Props) {
  if (count === 0) return null;
  return (
    <div role="toolbar" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
      <span className="font-medium">{count} selected</span>
      <Button size="sm" variant="outline" onClick={onSuspend}>
        <Pause className="mr-1 h-4 w-4" /> Suspend
      </Button>
      <Button size="sm" variant="outline" onClick={onReactivate}>
        <Play className="mr-1 h-4 w-4" /> Reactivate
      </Button>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        <X className="mr-1 h-4 w-4" /> Clear
      </Button>
    </div>
  );
}
