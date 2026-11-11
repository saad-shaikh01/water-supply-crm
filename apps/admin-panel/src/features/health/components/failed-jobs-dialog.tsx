'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Skeleton } from '@water-supply-crm/ui';
import { ErrorState } from '../../../components/shared/error-state';
import { useFailedJobs } from '../hooks/use-system-health';
import { formatDateTime } from '../../observability/lib/format';

interface Props {
  queue: string | null;
  onClose: () => void;
}

/** Shows the failure reasons only (the API never returns job payloads). */
export function FailedJobsDialog({ queue, onClose }: Props) {
  const { data, isLoading, error, refetch } = useFailedJobs(queue);
  return (
    <Dialog open={!!queue} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="failed-jobs-dialog">
        <DialogHeader>
          <DialogTitle>Failed jobs: {queue}</DialogTitle>
          <DialogDescription>Most recent failures. Job payloads are never shown.</DialogDescription>
        </DialogHeader>
        {isLoading && <Skeleton className="h-24 w-full" />}
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
        {data && data.jobs.length === 0 && <p className="text-sm text-muted-foreground">No failed jobs retained.</p>}
        <ul className="space-y-2">
          {data?.jobs.map((j, i) => (
            <li key={`${j.id}-${i}`} className="rounded-md border p-3 text-sm" data-testid="failed-job">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs">
                  #{j.id ?? '—'} {j.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {j.finishedOn ? formatDateTime(new Date(j.finishedOn).toISOString()) : '—'} · {j.attemptsMade} attempts
                </span>
              </div>
              <p className="mt-1 break-words text-red-600">{j.failedReason ?? 'No reason recorded'}</p>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
