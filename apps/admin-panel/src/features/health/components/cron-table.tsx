import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@water-supply-crm/ui';
import { AlertTriangle } from 'lucide-react';
import { describeCron, formatDateTime, relativeTime } from '../../observability/lib/format';
import type { CronHealth } from '../api/health.api';

export function CronTable({ crons }: { crons: CronHealth[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Job</TableHead>
            <TableHead>Schedule</TableHead>
            <TableHead>Last run</TableHead>
            <TableHead>Next run</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {crons.map((c) => (
            <TableRow key={c.jobId} data-testid="cron-row">
              <TableCell>
                <div className="font-medium">{c.label}</div>
                <div className="font-mono text-xs text-muted-foreground">{c.queue}</div>
              </TableCell>
              <TableCell>
                <div>{describeCron(c.pattern)}</div>
                {c.tz && <div className="text-xs text-muted-foreground">{c.tz}</div>}
              </TableCell>
              <TableCell>
                {c.lastRun ? (
                  <div className="space-y-1">
                    <Badge variant={c.lastRun.status === 'failed' ? 'destructive' : 'success'}>{c.lastRun.status}</Badge>
                    <div className="text-xs text-muted-foreground" title={formatDateTime(c.lastRun.finishedAt)}>
                      {relativeTime(c.lastRun.finishedAt)}
                    </div>
                    {c.lastRun.failedReason && <div className="break-words text-xs text-red-600">{c.lastRun.failedReason}</div>}
                  </div>
                ) : (
                  <span className="text-muted-foreground">No history</span>
                )}
              </TableCell>
              <TableCell>
                {c.registered === false ? (
                  <span className="flex items-center gap-1 font-medium text-amber-600" data-testid="cron-not-registered">
                    <AlertTriangle className="h-4 w-4" /> Not registered
                  </span>
                ) : c.registered === null ? (
                  <span className="text-muted-foreground">Unknown</span>
                ) : (
                  <span title={formatDateTime(c.nextRunAt)}>{relativeTime(c.nextRunAt)}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
