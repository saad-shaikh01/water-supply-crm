'use client';

import { useState } from 'react';
import { Badge, Button } from '@water-supply-crm/ui';
import { DataTable, type DataTableColumn } from '../../../components/shared/data-table';
import type { ImpersonationSession } from '../api/impersonation.api';
import { useImpersonationSessions, useRevokeImpersonation } from '../hooks/use-impersonation';

const isLive = (s: ImpersonationSession) => !s.endedAt && new Date(s.expiresAt).getTime() > Date.now();

export function ImpersonationSessionsTab({ vendorId }: { vendorId: string }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const { data, isLoading, error, refetch } = useImpersonationSessions({ vendorId, page, limit });
  const revoke = useRevokeImpersonation();

  const columns: DataTableColumn<ImpersonationSession>[] = [
    { key: 'started', header: 'Started', cell: (s) => <span className="whitespace-nowrap text-muted-foreground">{new Date(s.startedAt).toLocaleString()}</span> },
    { key: 'actor', header: 'Staff', cell: (s) => s.actorName },
    { key: 'target', header: 'As', cell: (s) => s.targetName },
    { key: 'mode', header: 'Mode', cell: (s) => <Badge variant="outline">{s.mode === 'READ_ONLY' ? 'Read-only' : 'Support'}</Badge> },
    { key: 'reason', header: 'Reason', cell: (s) => <span className="text-muted-foreground">{s.reason}</span> },
    { key: 'actions', header: 'Actions', cell: (s) => <span className="tabular-nums">{s.actionCount}</span> },
    {
      key: 'status',
      header: 'Status',
      cell: (s) => (isLive(s) ? <Badge data-testid="session-live">Active</Badge> : <Badge variant="secondary">{(s.endedReason ?? 'EXPIRED').toLowerCase()}</Badge>),
    },
    {
      key: 'revoke',
      header: '',
      cell: (s) =>
        isLive(s) ? (
          <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)} aria-label={`Revoke session ${s.id}`}>
            Revoke
          </Button>
        ) : null,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={data?.data ?? []}
      rowKey={(r) => r.id}
      isLoading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      empty={{ title: 'No impersonation sessions', description: 'Sessions started for this vendor will be listed here.' }}
      pagination={{ page, limit, total: data?.meta?.total ?? 0, onPageChange: setPage, onLimitChange: setLimit }}
    />
  );
}
