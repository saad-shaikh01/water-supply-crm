'use client';

import { useState } from 'react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@water-supply-crm/ui';
import { DataTable, type DataTableColumn } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { useAdminSessions, useSessionActions } from '../hooks/use-security';
import type { AdminSession } from '../api/security.api';

const when = (iso: string) => new Date(iso).toLocaleString();

/** Short, readable device label from a User-Agent string. */
export function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function SessionsCard() {
  const sessions = useAdminSessions();
  const { revoke, revokeOthers } = useSessionActions();
  const [target, setTarget] = useState<AdminSession | null>(null);
  const rows = sessions.data ?? [];
  const hasOthers = rows.some((s) => !s.current);

  const columns: DataTableColumn<AdminSession>[] = [
    {
      key: 'device',
      header: 'Device',
      cell: (s) => (
        <div className="flex items-center gap-2">
          <span>{describeAgent(s.userAgent)}</span>
          {s.current && <Badge data-testid="current-session">Current</Badge>}
        </div>
      ),
    },
    { key: 'ip', header: 'IP address', cell: (s) => s.ip ?? '-' },
    { key: 'signedIn', header: 'Signed in', cell: (s) => when(s.createdAt) },
    { key: 'lastSeen', header: 'Last active', cell: (s) => when(s.lastSeenAt) },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (s) => (
        <Button variant="outline" size="sm" aria-label={`Revoke session ${s.id}`} onClick={() => setTarget(s)}>
          Revoke
        </Button>
      ),
    },
  ];

  return (
    <Card data-testid="sessions-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Active sessions</CardTitle>
            <CardDescription>Devices currently signed in to your account.</CardDescription>
          </div>
          <Button variant="outline" disabled={!hasOthers || revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>
            Revoke all others
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.id}
          isLoading={sessions.isLoading}
          error={sessions.error}
          onRetry={() => sessions.refetch()}
          empty={{ title: 'No active sessions' }}
        />
      </CardContent>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Revoke session?"
        description={
          target?.current
            ? 'This is your current session. Revoking it signs you out of this browser.'
            : 'The device will be signed out immediately.'
        }
        confirmLabel="Revoke"
        isPending={revoke.isPending}
        onConfirm={() => target && revoke.mutate({ id: target.id, current: target.current }, { onSettled: () => setTarget(null) })}
      />
    </Card>
  );
}
