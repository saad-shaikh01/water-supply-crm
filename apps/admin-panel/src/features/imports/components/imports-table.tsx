'use client';

import { DataTable, type DataTableColumn } from '../../../components/shared/data-table';
import { StatusBadge } from '../../observability/components/status-badge';
import { formatBytes, formatDateTime } from '../../observability/lib/format';
import type { ImportRow } from '../api/imports.api';

interface Props {
  rows: ImportRow[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onSelect: (row: ImportRow) => void;
  pagination: {
    page: number;
    limit: number;
    total: number;
    onPageChange: (page: number) => void;
    onLimitChange: (limit: number) => void;
  };
}

export function ImportsTable({ rows, isLoading, error, onRetry, onSelect, pagination }: Props) {
  const columns: DataTableColumn<ImportRow>[] = [
    {
      key: 'created',
      header: 'Created',
      className: 'whitespace-nowrap',
      cell: (r) => (
        <button type="button" className="text-left hover:underline" onClick={() => onSelect(r)} aria-label={`View import ${r.sourceFileName ?? r.id}`}>
          {formatDateTime(r.createdAt)}
        </button>
      ),
    },
    { key: 'vendor', header: 'Vendor', cell: (r) => r.vendorName ?? '—' },
    { key: 'entity', header: 'Entity', cell: (r) => r.entity.replace(/_/g, ' ') },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'file', header: 'File', cell: (r) => <span className="block max-w-[180px] truncate">{r.sourceFileName ?? '—'}</span> },
    { key: 'size', header: 'Size', cell: (r) => formatBytes(r.sourceFileSize) },
    { key: 'rows', header: 'Rows', cell: (r) => r.rowCount ?? '—' },
    {
      key: 'error',
      header: 'Error',
      cell: (r) => (r.errorMessage ? <span className="block max-w-[220px] truncate text-red-600" title={r.errorMessage}>{r.errorMessage}</span> : '—'),
    },
  ];
  return (
    <div className="overflow-x-auto">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        empty={{ title: 'No import jobs', description: 'No imports match these filters.' }}
        pagination={pagination}
      />
    </div>
  );
}
