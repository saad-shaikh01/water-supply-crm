'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@water-supply-crm/ui';
import type { QueueHealth } from '../api/health.api';

interface Props {
  queues: QueueHealth[];
  onSelectFailed: (queue: string) => void;
}

const num = (n: number | undefined | null) => (n == null ? '—' : n.toLocaleString('en-US'));

export function QueueTable({ queues, onSelectFailed }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Queue</TableHead>
            <TableHead className="text-right">Waiting</TableHead>
            <TableHead className="text-right">Active</TableHead>
            <TableHead className="text-right">Delayed</TableHead>
            <TableHead className="text-right">Failed</TableHead>
            <TableHead>State</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {queues.map((q) => {
            const unknown = q.status === 'unknown' || !q.counts;
            const failed = q.counts?.failed ?? 0;
            return (
              <TableRow key={q.name} data-testid="queue-row" data-failed={failed > 0 ? 'true' : 'false'} className={failed > 0 ? 'bg-red-500/5' : undefined}>
                <TableCell className="font-mono text-xs">{q.name}</TableCell>
                {unknown ? (
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    Unavailable
                  </TableCell>
                ) : (
                  <>
                    <TableCell className="text-right">{num(q.counts?.waiting)}</TableCell>
                    <TableCell className="text-right">{num(q.counts?.active)}</TableCell>
                    <TableCell className="text-right">{num(q.counts?.delayed)}</TableCell>
                    <TableCell className="text-right">
                      {failed > 0 ? (
                        <button
                          type="button"
                          className="font-semibold text-red-600 underline decoration-dotted hover:text-red-700"
                          onClick={() => onSelectFailed(q.name)}
                          aria-label={`View ${failed} failed jobs in ${q.name}`}
                        >
                          {num(failed)}
                        </button>
                      ) : (
                        num(failed)
                      )}
                    </TableCell>
                  </>
                )}
                <TableCell>{q.paused ? <span className="text-amber-600">Paused</span> : unknown ? '—' : 'Running'}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
