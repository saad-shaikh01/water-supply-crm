'use client';

import { useState } from 'react';
import { Badge, Button } from '@water-supply-crm/ui';
import { RefreshCw, UserPlus, X } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { formatDateTime } from '../../observability/lib/format';
import { AccountStatusBadge } from './account-status-badge';
import { AssignVendorDialog } from './assign-vendor-dialog';
import { useUnassignVendor, useVerifyAccount } from '../hooks/use-whatsapp-accounts';
import type { WhatsAppAccountRow } from '../api/whatsapp.api';

interface Props {
  rows: WhatsAppAccountRow[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  pagination: {
    page: number;
    limit: number;
    total: number;
    onPageChange: (page: number) => void;
    onLimitChange: (limit: number) => void;
  };
}

export function AccountsTable({ rows, isLoading, error, onRetry, pagination }: Props) {
  const [assignTarget, setAssignTarget] = useState<WhatsAppAccountRow | null>(null);
  const [unassignTarget, setUnassignTarget] = useState<{ accountId: string; vendorId: string; vendorName: string } | null>(null);
  const unassign = useUnassignVendor();
  const verify = useVerifyAccount();

  const columns: DataTableColumn<WhatsAppAccountRow>[] = [
    { key: 'label', header: 'Account', cell: (a) => <span className="font-medium">{a.label}</span> },
    {
      key: 'number',
      header: 'Number',
      cell: (a) => (
        <div>
          <div>{a.displayNumber ?? '—'}</div>
          {a.verifiedName && <div className="text-xs text-muted-foreground">{a.verifiedName}</div>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (a) => <AccountStatusBadge status={a.status} /> },
    { key: 'quality', header: 'Quality', cell: (a) => a.qualityRating ?? '—' },
    {
      key: 'health',
      header: 'Last check',
      cell: (a) => (
        <div className="max-w-[220px]">
          <div className="text-xs text-muted-foreground">{formatDateTime(a.lastHealthCheckAt)}</div>
          {a.lastHealthError && <div className="break-words text-xs text-red-600">{a.lastHealthError}</div>}
        </div>
      ),
    },
    {
      key: 'vendors',
      header: 'Assigned vendors',
      cell: (a) =>
        a.vendors.length === 0 ? (
          <span className="text-muted-foreground">None</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {a.vendors.map((v) => (
              <Badge key={v.id} variant="outline" className="gap-1 pr-1" data-testid="vendor-chip">
                {v.name}
                <button
                  type="button"
                  aria-label={`Unassign ${v.name}`}
                  className="rounded-sm p-0.5 hover:bg-muted"
                  onClick={() => setUnassignTarget({ accountId: a.id, vendorId: v.id, vendorName: v.name })}
                  disabled={unassign.isPending}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        ),
    },
    {
      key: 'actions',
      header: '',
      cell: (a) => (
        <div className="flex justify-end gap-1">
          <Button variant="outline" size="sm" onClick={() => setAssignTarget(a)} aria-label={`Assign vendor to ${a.label}`}>
            <UserPlus className="mr-1 h-4 w-4" />
            Assign
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => verify.mutate(a.id)}
            disabled={verify.isPending && verify.variables === a.id}
            aria-label={`Verify ${a.label} now`}
          >
            <RefreshCw className={`mr-1 h-4 w-4 ${verify.isPending && verify.variables === a.id ? 'animate-spin' : ''}`} />
            Verify now
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="overflow-x-auto">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          isLoading={isLoading}
          error={error}
          onRetry={onRetry}
          empty={{ title: 'No WhatsApp accounts', description: 'No accounts match these filters.' }}
          pagination={pagination}
        />
      </div>
      <AssignVendorDialog account={assignTarget} onClose={() => setAssignTarget(null)} />
      <ConfirmDialog
        open={!!unassignTarget}
        onOpenChange={(o) => !o && setUnassignTarget(null)}
        title="Unassign vendor?"
        description={`This does not delete the account. Customer WhatsApp messages stop for ${unassignTarget?.vendorName ?? 'this vendor'} until another account is assigned.`}
        confirmLabel="Unassign"
        isPending={unassign.isPending}
        onConfirm={() =>
          unassignTarget &&
          unassign.mutate({ id: unassignTarget.accountId, vendorId: unassignTarget.vendorId }, { onSettled: () => setUnassignTarget(null) })
        }
      />
    </>
  );
}
