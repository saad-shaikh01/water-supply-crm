'use client';

import { DataTable, type DataTableColumn } from '../../../components/shared/data-table';
import { StatusBadge } from '../../observability/components/status-badge';
import { formatDateTime } from '../../observability/lib/format';
import type { AuditRow } from '../api/audit.api';

interface Props {
  rows: AuditRow[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onSelect: (row: AuditRow) => void;
  pagination: {
    page: number;
    limit: number;
    total: number;
    onPageChange: (page: number) => void;
    onLimitChange: (limit: number) => void;
  };
}

export function AuditTable({ rows, isLoading, error, onRetry, onSelect, pagination }: Props) {
  const open = (r: AuditRow) => (
    <button
      type="button"
      className="text-left hover:underline focus-visible:underline focus-visible:outline-none"
      onClick={() => onSelect(r)}
      aria-label={`View audit entry ${r.action} ${r.entity}`}
    >
      {formatDateTime(r.createdAt)}
    </button>
  );
  const columns: DataTableColumn<AuditRow>[] = [
    { key: 'time', header: 'Time', className: 'whitespace-nowrap', cell: open },
    { key: 'vendor', header: 'Vendor', cell: (r) => r.vendorName ?? <span className="text-muted-foreground">Platform</span> },
    { key: 'user', header: 'User', cell: (r) => r.userName ?? <span className="text-muted-foreground">System</span> },
    { key: 'action', header: 'Action', cell: (r) => <StatusBadge status={r.action} /> },
    { key: 'entity', header: 'Entity', cell: (r) => r.entity },
    {
      key: 'entityId',
      header: 'Entity ID',
      cell: (r) => <span className="block max-w-[140px] truncate font-mono text-xs text-muted-foreground">{r.entityId ?? '—'}</span>,
    },
  ];

  return (
    <div
      className="[&_tbody_tr]:cursor-pointer"
      onClick={(e) => {
        // whole-row click opens the drawer
        const tr = (e.target as HTMLElement).closest('tbody tr');
        if (!tr || (e.target as HTMLElement).closest('button')) return;
        const idx = Array.from(tr.parentElement?.children ?? []).indexOf(tr);
        if (idx >= 0 && rows[idx]) onSelect(rows[idx]);
      }}
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        empty={{ title: 'No audit entries', description: 'No audit entries match these filters.' }}
        pagination={pagination}
      />
    </div>
  );
}
