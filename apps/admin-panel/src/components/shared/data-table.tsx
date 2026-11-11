'use client';

import type { ReactNode } from 'react';
import {
  DataTablePagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@water-supply-crm/ui';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { TableSkeleton } from './table-skeleton';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: { title: string; description?: string; action?: ReactNode };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    onPageChange: (page: number) => void;
    onLimitChange: (limit: number) => void;
  };
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  onRetry,
  empty,
  pagination,
}: DataTableProps<T>) {
  if (isLoading) return <TableSkeleton cols={columns.length} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) {
    return <EmptyState title={empty?.title ?? 'No results'} description={empty?.description} action={empty?.action} />;
  }

  return (
    <>
      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={c.className}>
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={c.className}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pagination && <DataTablePagination {...pagination} />}
    </>
  );
}
