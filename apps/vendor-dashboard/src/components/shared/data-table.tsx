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
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border/50 overflow-hidden">
          <div className="h-10 bg-muted/30 border-b border-border/50" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 border-b border-border/50 last:border-0">
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 space-y-4">
      <div className="rounded-[2.5rem] border border-white/10 bg-card/40 backdrop-blur-xl overflow-hidden shadow-glass transition-all duration-500 hover:shadow-premium">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20 hover:bg-muted/20 border-b border-border/50">
              {columns.map((col) => (
                <TableHead 
                  key={col.key} 
                  className="h-11 text-xs uppercase tracking-wider font-bold text-muted-foreground"
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
                  className="h-64 text-center"
                >
                  <div className="flex flex-col items-center justify-center space-y-2 opacity-50">
                    <Inbox className="h-10 w-10 text-muted-foreground/50" />
                    <p className="text-sm font-medium text-muted-foreground">{emptyMessage}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, idx) => (
                <TableRow 
                  key={row.id} 
                  className={cn(
                    "group transition-colors border-b border-border/50 last:border-0 hover:bg-primary/[0.02]",
                    idx % 2 === 0 ? "bg-transparent" : "bg-muted/5"
                  )}
                >
                  {columns.map((col) => (
                    <TableCell key={col.key} className="py-4 text-sm">
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      
      {onPageChange && onLimitChange && (
        <DataTablePagination 
          page={page}
          limit={limit}
          total={total}
          onPageChange={onPageChange}
          onLimitChange={onLimitChange}
        />
      )}
    </div>
  );
}
