'use client';

import { useEffect, useState } from 'react';
import { Badge, Input } from '@water-supply-crm/ui';
import { useVendorAudit } from '../../hooks/use-vendor-detail';
import { redactSensitive } from '../../lib/redact';
import { DataTable, type DataTableColumn } from '../../../../components/shared/data-table';
import type { AuditLogRow, VendorRow } from '../../types';

const ACTIONS = ['CREATE', 'UPDATE', 'SUSPEND', 'UNSUSPEND', 'DELETE', 'PROVISION', 'RESET_ADMIN_PASSWORD', 'GO_LIVE', 'GO_OFFLINE'];
const ENTITIES = 'Vendor,User,VendorBranding';

const reasonOf = (changes: unknown): string | null => {
  const r = (changes as { reason?: unknown } | null)?.reason;
  return typeof r === 'string' && r ? r : null;
};

function ChangesCell({ row }: { row: AuditLogRow }) {
  const [open, setOpen] = useState(false);
  if (row.changes == null) return <span className="text-muted-foreground">—</span>;
  return (
    <div>
      <button type="button" className="text-xs text-primary underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide changes' : 'Show changes'}
      </button>
      {open && <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(redactSensitive(row.changes), null, 2)}</pre>}
    </div>
  );
}

export function ActivityTab({ vendor }: { vendor: VendorRow }) {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  useEffect(() => setPage(1), [action, from, to, limit]);

  const { data, isLoading, error, refetch } = useVendorAudit(vendor.id, {
    page,
    limit,
    entities: ENTITIES,
    action: action || undefined,
    from: from || undefined,
    to: to ? `${to}T23:59:59.999Z` : undefined,
  });

  const columns: DataTableColumn<AuditLogRow>[] = [
    { key: 'time', header: 'Time', cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span> },
    { key: 'actor', header: 'Actor', cell: (r) => r.userName ?? 'System' },
    { key: 'action', header: 'Action', cell: (r) => <Badge variant="outline">{r.action}</Badge> },
    { key: 'entity', header: 'Entity', cell: (r) => r.entity },
    { key: 'reason', header: 'Reason', cell: (r) => <span className="text-muted-foreground">{reasonOf(r.changes) ?? '—'}</span> },
    { key: 'changes', header: 'Changes', cell: (r) => <ChangesCell row={r} /> },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Action</span>
          <select aria-label="Filter by action" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">From</span>
          <Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">To</span>
          <Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        empty={{ title: 'No activity yet', description: 'Changes made to this vendor will be listed here.' }}
        pagination={{ page, limit, total: data?.meta?.total ?? 0, onPageChange: setPage, onLimitChange: setLimit }}
      />
    </div>
  );
}
