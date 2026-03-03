'use client';

import { ReactNode } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Button, Skeleton, DataTablePagination
} from '@water-supply-crm/ui';
import { Inbox } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';

interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  width?: string;
}

interface DataTableProps<T> {
  data: T[] | undefined;
  columns: Column<T>[];
  isLoading?: boolean;
  page?: number;
  limit?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  emptyMessage?: string;
}

export function DataTable<T extends { id: string }>({
  data,
  columns,
  isLoading,
  page = 1,
  limit = 20,
  total = 0,
  onPageChange,
  onLimitChange,
  emptyMessage = 'No data found',
}: DataTableProps<T>) {
  // Component implementation
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-border overflow-hidden bg-white/[0.02] backdrop-blur-2xl">
          <div className="h-12 sm:h-14 bg-white/[0.01] border-b border-border" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 sm:p-6 border-b border-border/50 last:border-0">
              <Skeleton className="h-4 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 relative">
      <div className="rounded-2xl border border-border bg-white/[0.02] backdrop-blur-2xl overflow-hidden shadow-2xl mb-6">
        <Table>
          <TableHeader>
            <TableRow className="bg-white/[0.01] hover:bg-white/[0.01] border-b border-border">
              {columns.map((col) => (
                <TableHead 
                  key={col.key} 
                  className="h-12 sm:h-14 text-[10px] uppercase tracking-[0.25em] font-bold text-muted-foreground"
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data?.length ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-72 text-center"
                >
                  <div className="flex flex-col items-center justify-center space-y-4">
                    <div className="p-6 rounded-2xl bg-white/[0.01] border border-border">
                      <Inbox className="h-10 w-10 text-muted-foreground/40" />
                    </div>
                    <p className="text-sm font-bold text-muted-foreground/30 tracking-tight">{emptyMessage}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => (
                <TableRow 
                  key={row.id} 
                  className="group/row transition-colors border-b border-border/50 last:border-0 hover:bg-white/[0.04]"
                >
                  {columns.map((col) => (
                    <TableCell key={col.key} className="py-3 px-4 sm:py-4 sm:px-6">
                      <div className={cn(
                        "text-sm font-medium transition-colors text-foreground/90 group-hover:text-primary",
                        // Auto-apply tabular-nums if column looks like a number
                        (col.header.toLowerCase().includes('balance') || col.header.toLowerCase().includes('amount')) && "tabular-nums"
                      )}>
                        {col.cell(row)}
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      
      {onPageChange && onLimitChange && (
        <div className="sticky bottom-4 z-30 mt-auto">
          <div className="mx-auto max-w-fit sm:max-w-none">
            <div className="bg-[#0a0a0f]/80 backdrop-blur-2xl border border-white/10 rounded-2xl p-1 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] overflow-hidden">
              <DataTablePagination 
                page={page}
                limit={limit}
                total={total}
                onPageChange={onPageChange}
                onLimitChange={onLimitChange}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
