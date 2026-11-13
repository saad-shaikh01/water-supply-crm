'use client';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton } from '@water-supply-crm/ui';
import { ErrorState } from '../../../components/shared/error-state';
import { StatusBadge } from '../../observability/components/status-badge';
import { formatBytes, formatDateTime } from '../../observability/lib/format';
import { useImportDetail } from '../hooks/use-imports';

interface Props {
  id: string | null;
  onClose: () => void;
}

/** Read-only: no download or source-file link is exposed. */
export function ImportDetailDrawer({ id, onClose }: Props) {
  const { data, isLoading, error, refetch } = useImportDetail(id);
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl" data-testid="import-drawer">
        <SheetHeader>
          <SheetTitle>Import details</SheetTitle>
          <SheetDescription>{data ? `${data.vendorName ?? 'Vendor'} · ${data.entity.replace(/_/g, ' ')}` : 'Loading...'}</SheetDescription>
        </SheetHeader>
        {isLoading && <Skeleton className="mt-4 h-40 w-full" />}
        {error ? <div className="mt-4"><ErrorState error={error} onRetry={() => refetch()} /></div> : null}
        {data && (
          <div className="mt-4 space-y-4 text-sm">
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd><StatusBadge status={data.status} /></dd>
              <dt className="text-muted-foreground">File</dt>
              <dd className="break-all">{data.sourceFileName ?? '—'} ({formatBytes(data.sourceFileSize)})</dd>
              <dt className="text-muted-foreground">Rows</dt>
              <dd>{data.rowCount ?? '—'}</dd>
              <dt className="text-muted-foreground">Created by</dt>
              <dd>{data.createdByName ?? '—'}</dd>
              <dt className="text-muted-foreground">Created</dt>
              <dd>{formatDateTime(data.createdAt)}</dd>
              <dt className="text-muted-foreground">Started</dt>
              <dd>{formatDateTime(data.startedAt)}</dd>
              <dt className="text-muted-foreground">Completed</dt>
              <dd>{formatDateTime(data.completedAt)}</dd>
            </dl>
            {(data.errorCode || data.errorMessage) && (
              <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3" data-testid="import-error">
                <div className="font-semibold text-red-600">{data.errorCode ?? 'Error'}</div>
                <div className="break-words">{data.errorMessage}</div>
              </div>
            )}
            <div data-testid="import-queue-state">
              <h3 className="mb-1 font-semibold">Queue state</h3>
              {data.queueState ? (
                <p>
                  {data.queueState.state} · {data.queueState.attemptsMade} attempts
                  {data.queueState.failedReason && <span className="block break-words text-red-600">{data.queueState.failedReason}</span>}
                </p>
              ) : (
                <p className="text-muted-foreground">No queue job found (finished or never queued).</p>
              )}
            </div>
            {data.summary && Object.keys(data.summary).length > 0 && (
              <div>
                <h3 className="mb-1 font-semibold">Counters</h3>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {Object.entries(data.summary).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="break-all text-muted-foreground">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
