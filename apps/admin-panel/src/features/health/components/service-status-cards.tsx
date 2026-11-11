import { Card, CardContent, CardHeader, CardTitle } from '@water-supply-crm/ui';
import { AlertTriangle } from 'lucide-react';
import { StatusBadge } from '../../observability/components/status-badge';
import type { SystemHealth } from '../api/health.api';

export type OverallStatus = 'healthy' | 'degraded' | 'down';

export function overallStatus(h: SystemHealth): OverallStatus {
  if (h.database?.status === 'down' || h.api?.status === 'down') return 'down';
  const queueIssue = (h.queues ?? []).some((q) => q.status === 'unknown');
  const cronIssue = (h.crons ?? []).some((c) => c.registered === false);
  if (h.redis?.status !== 'up' || !h.database || queueIssue || cronIssue || h.redis.policyOk === false) return 'degraded';
  return 'healthy';
}

const BANNER: Record<OverallStatus, { cls: string; text: string }> = {
  healthy: { cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', text: 'All systems healthy' },
  degraded: { cls: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400', text: 'Degraded: some components need attention' },
  down: { cls: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400', text: 'System down: a core service is unreachable' },
};

export function StatusBanner({ status }: { status: OverallStatus }) {
  const b = BANNER[status];
  return (
    <div role="status" data-testid="health-banner" data-status={status} className={`rounded-lg border px-4 py-3 text-sm font-semibold ${b.cls}`}>
      {b.text}
    </div>
  );
}

function ServiceCard({ title, status, latency, children, testId }: { title: string; status: string; latency?: number | null; children?: React.ReactNode; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <StatusBadge status={status} />
      </CardHeader>
      <CardContent className="space-y-1 text-sm text-muted-foreground">
        <p>Latency: {latency != null ? `${latency} ms` : '—'}</p>
        {children}
      </CardContent>
    </Card>
  );
}

export function ServiceStatusCards({ health }: { health: SystemHealth }) {
  const { api, database, redis } = health;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <ServiceCard testId="card-api" title="API" status={api?.status ?? 'unknown'} latency={null}>
        <p>Version: {api?.version ?? '—'}</p>
      </ServiceCard>
      <ServiceCard testId="card-db" title="Database" status={database?.status ?? 'unknown'} latency={database?.latencyMs} />
      <ServiceCard testId="card-redis" title="Redis" status={redis?.status ?? 'unknown'} latency={redis?.latencyMs}>
        {redis?.usedMemoryMb != null && <p>Memory: {redis.usedMemoryMb} MB</p>}
        {redis?.maxmemoryPolicy && <p>Eviction policy: {redis.maxmemoryPolicy}</p>}
        {redis?.policyOk === false && (
          <p className="flex items-center gap-1 font-medium text-amber-600" data-testid="redis-policy-warning">
            <AlertTriangle className="h-4 w-4" /> Eviction policy is not noeviction; queue data may be evicted.
          </p>
        )}
      </ServiceCard>
    </div>
  );
}
