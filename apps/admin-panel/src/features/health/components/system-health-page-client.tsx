'use client';

import { useState } from 'react';
import { Button, Skeleton } from '@water-supply-crm/ui';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { ErrorState } from '../../../components/shared/error-state';
import { useSystemHealth } from '../hooks/use-system-health';
import { overallStatus, ServiceStatusCards, StatusBanner } from './service-status-cards';
import { QueueTable } from './queue-table';
import { CronTable } from './cron-table';
import { RuntimeCard } from './runtime-card';
import { FailedJobsDialog } from './failed-jobs-dialog';
import { formatDateTime, relativeTime } from '../../observability/lib/format';

export function SystemHealthPageClient() {
  const { data, isLoading, error, refetch, refreshNow, refreshDisabled } = useSystemHealth();
  const [failedQueue, setFailedQueue] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Health"
        description="API, database, Redis, queues and scheduled jobs"
        actions={
          <div className="flex items-center gap-3">
            {data && (
              <span className="hidden text-xs text-muted-foreground sm:inline" data-testid="health-updated" title={formatDateTime(data.generatedAt)}>
                Last updated {relativeTime(data.generatedAt)}
                {data.cached ? ' (cached)' : ''}
              </span>
            )}
            <Button variant="outline" onClick={() => refreshNow()} disabled={refreshDisabled}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh now
            </Button>
          </div>
        }
      />
      {isLoading && <Skeleton className="h-40 w-full" />}
      {error && !data ? <ErrorState error={error} onRetry={() => refetch()} /> : null}
      {data && (
        <>
          <StatusBanner status={overallStatus(data)} />
          <ServiceStatusCards health={data} />
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Queues</h2>
            {data.queues ? <QueueTable queues={data.queues} onSelectFailed={setFailedQueue} /> : <p className="text-sm text-muted-foreground">Queue data unavailable.</p>}
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Scheduled jobs</h2>
            {data.crons ? <CronTable crons={data.crons} /> : <p className="text-sm text-muted-foreground">Cron data unavailable.</p>}
          </section>
          <RuntimeCard health={data} />
        </>
      )}
      <FailedJobsDialog queue={failedQueue} onClose={() => setFailedQueue(null)} />
    </div>
  );
}
