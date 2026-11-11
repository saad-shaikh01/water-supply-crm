'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Input } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { DataTable, type DataTableColumn } from '../../../components/shared/data-table';
import { NativeSelect } from '../../observability/components/native-select';
import { compactParams, useUrlFilters } from '../../observability/hooks/use-url-filters';
import { formatDateTime } from '../../observability/lib/format';
import { useAuthStore } from '../../../store/auth.store';
import { usePlatformAdminActions, usePlatformAdmins } from '../hooks/use-platform-admins';
import type { PlatformAdminRow } from '../api/platform-admins.api';
import { CreateAdminDialog } from './create-admin-dialog';
import { ReasonDialog } from './reason-dialog';
import { ResetPasswordDialog } from './reset-password-dialog';
import { TempPasswordDialog } from './temp-password-dialog';

const KEYS = ['search', 'isActive'] as const;

type Pending = { kind: 'deactivate' | 'reset2fa' | 'resetPassword'; row: PlatformAdminRow } | null;

export function PlatformAdminsPageClient() {
  const url = useUrlFilters(KEYS);
  const me = useAuthStore((s) => s.user);
  const [search, setSearch] = useState(url.values.search);
  useEffect(() => setSearch(url.values.search), [url.values.search]);
  useEffect(() => {
    if (search === url.values.search) return;
    const t = setTimeout(() => url.setFilters({ search }), 400);
    return () => clearTimeout(t);
  }, [search]);

  const params = compactParams({ search: url.values.search, isActive: url.values.isActive, page: url.page, limit: url.limit });
  const { data, isLoading, error, refetch } = usePlatformAdmins(params);
  const actions = usePlatformAdminActions();

  const [createOpen, setCreateOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [temp, setTemp] = useState<{ password: string; who: string } | null>(null);
  const close = () => setPending(null);

  const rows = data?.data ?? [];
  const filtered = !!(url.values.search || url.values.isActive);
  // Only decidable client-side when the whole unfiltered list is on screen; the server enforces it regardless (409 LAST_ADMIN).
  const activeCount = rows.filter((r) => r.isActive).length;
  const isLastActive = (r: PlatformAdminRow) =>
    !filtered && (data?.meta.total ?? 0) === rows.length && r.isActive && activeCount === 1;

  const columns: DataTableColumn<PlatformAdminRow>[] = [
    {
      key: 'name',
      header: 'Administrator',
      cell: (r) => (
        <div>
          <div className="font-medium">
            {r.name}
            {r.id === me?.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
          </div>
          <div className="text-xs text-muted-foreground">{r.email}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <Badge variant={r.isActive ? 'success' : 'destructive'}>{r.isActive ? 'Active' : 'Deactivated'}</Badge>,
    },
    {
      key: '2fa',
      header: '2FA',
      cell: (r) => (
        <Badge variant={r.twoFactorEnabled ? 'info' : 'warning'} data-testid="admin-2fa-badge">
          {r.twoFactorEnabled ? '2FA on' : '2FA off'}
        </Badge>
      ),
    },
    { key: 'lastLogin', header: 'Last sign-in', cell: (r) => formatDateTime(r.lastLoginAt) },
    { key: 'sessions', header: 'Sessions', cell: (r) => r.activeSessions },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (r) => {
        const self = r.id === me?.id;
        const last = isLastActive(r);
        return (
          <div className="flex flex-wrap justify-end gap-1.5">
            {r.isActive ? (
              <Button
                size="sm"
                variant="outline"
                disabled={self || last}
                title={self ? 'You cannot deactivate your own account' : last ? 'This is the last active administrator' : undefined}
                aria-label={`Deactivate ${r.email}`}
                onClick={() => setPending({ kind: 'deactivate', row: r })}
              >
                Deactivate
              </Button>
            ) : (
              <Button size="sm" variant="outline" aria-label={`Activate ${r.email}`} onClick={() => actions.activate.mutate(r.id)}>
                Activate
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={self}
              aria-label={`Reset password ${r.email}`}
              onClick={() => setPending({ kind: 'resetPassword', row: r })}
            >
              Reset password
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={self}
              aria-label={`Reset 2FA ${r.email}`}
              onClick={() => setPending({ kind: 'reset2fa', row: r })}
            >
              Reset 2FA
            </Button>
            <Button size="sm" variant="outline" aria-label={`Unlock ${r.email}`} onClick={() => actions.unlock.mutate(r.id)}>
              Unlock
            </Button>
          </div>
        );
      },
    },
  ];

  const name = pending?.row.name ?? '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Administrators"
        description="Accounts that can sign in to this panel"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add administrator
          </Button>
        }
      />
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Input aria-label="Search administrators" placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect aria-label="Filter by status" value={url.values.isActive} onChange={(e) => url.setFilters({ isActive: e.target.value })}>
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Deactivated</option>
        </NativeSelect>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        empty={{ title: 'No administrators found' }}
        pagination={{
          page: url.page,
          limit: url.limit,
          total: data?.meta?.total ?? 0,
          onPageChange: url.setPage,
          onLimitChange: url.setLimit,
        }}
      />

      <CreateAdminDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={({ name: who, tempPassword }) => tempPassword && setTemp({ password: tempPassword, who })}
      />

      <ReasonDialog
        open={pending?.kind === 'deactivate'}
        onOpenChange={(o) => !o && close()}
        title={`Deactivate ${name}?`}
        description="They are signed out immediately and cannot sign in until reactivated."
        confirmLabel="Deactivate"
        isPending={actions.deactivate.isPending}
        onConfirm={(reason) => pending && actions.deactivate.mutate({ id: pending.row.id, reason }, { onSettled: close })}
      />
      <ReasonDialog
        open={pending?.kind === 'reset2fa'}
        onOpenChange={(o) => !o && close()}
        title={`Reset two-factor for ${name}?`}
        description="Their authenticator and recovery codes are removed and all their sessions are revoked. They must enroll again if enforcement is on."
        confirmLabel="Reset 2FA"
        isPending={actions.resetTwoFactor.isPending}
        onConfirm={(reason) => pending && actions.resetTwoFactor.mutate({ id: pending.row.id, reason }, { onSettled: close })}
      />
      <ResetPasswordDialog
        open={pending?.kind === 'resetPassword'}
        onOpenChange={(o) => !o && close()}
        name={name}
        isPending={actions.resetPassword.isPending}
        onChoose={(mode) =>
          pending &&
          actions.resetPassword.mutate(
            { id: pending.row.id, mode },
            {
              onSuccess: (r) => r.tempPassword && setTemp({ password: r.tempPassword, who: pending.row.name }),
              onSettled: close,
            },
          )
        }
      />

      <TempPasswordDialog password={temp?.password ?? null} who={temp?.who} onClose={() => setTemp(null)} />
    </div>
  );
}
