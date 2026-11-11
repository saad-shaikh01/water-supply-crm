'use client';

import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@water-supply-crm/ui';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { JsonDiffView } from '../../observability/components/json-diff-view';
import { StatusBadge } from '../../observability/components/status-badge';
import { formatDateTime } from '../../observability/lib/format';
import type { AuditRow } from '../api/audit.api';

interface Props {
  row: AuditRow | null;
  onClose: () => void;
}

function hasDiff(row: AuditRow): boolean {
  const c = row.changes;
  return !!c && (c.before !== undefined || c.after !== undefined) && (c.before != null || c.after != null);
}

export function AuditDetailDrawer({ row, onClose }: Props) {
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl" data-testid="audit-drawer">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <StatusBadge status={row.action} /> {row.entity}
              </SheetTitle>
              <SheetDescription>{formatDateTime(row.createdAt)}</SheetDescription>
            </SheetHeader>
            <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Vendor</dt>
              <dd>{row.vendorName ?? 'Platform'}</dd>
              <dt className="text-muted-foreground">User</dt>
              <dd>{row.userName ?? 'System'}</dd>
              <dt className="text-muted-foreground">Entity ID</dt>
              <dd className="flex items-center gap-2 break-all font-mono text-xs">
                {row.entityId ?? '—'}
                {row.entityId && (
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Copy entity ID" onClick={() => copy(row.entityId as string)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                )}
              </dd>
              <dt className="text-muted-foreground">Entry ID</dt>
              <dd className="break-all font-mono text-xs">{row.id}</dd>
            </dl>
            {row.changes?.reason && (
              <div className="mt-4 rounded-md border bg-muted/40 p-3 text-sm" data-testid="audit-reason">
                <span className="font-semibold">Reason: </span>
                {String(row.changes.reason)}
              </div>
            )}
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Changes</h3>
              {hasDiff(row) ? (
                <JsonDiffView before={row.changes?.before} after={row.changes?.after} />
              ) : (
                <p className="text-sm text-muted-foreground">No changes recorded</p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
