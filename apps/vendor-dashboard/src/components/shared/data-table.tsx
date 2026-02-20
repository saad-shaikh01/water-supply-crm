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
        <div className="rounded-3xl border border-border/50 overflow-hidden bg-card/20 backdrop-blur-xl">
          <div className="h-14 bg-muted/40 border-b border-border/50" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-6 border-b border-border/50 last:border-0">
              <Skeleton className="h-4 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 space-y-6">
      <div className="rounded-xl border border-border dark:border-white/5 bg-background dark:bg-[#05070a] overflow-hidden shadow-xl dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)] transition-all duration-500">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 dark:bg-white/[0.02] hover:bg-muted/50 dark:hover:bg-white/[0.02] border-b border-border dark:border-white/5">
              {columns.map((col) => (
                <TableHead 
                  key={col.key} 
                  className="h-14 text-[10px] uppercase tracking-[0.25em] font-bold text-muted-foreground/60 dark:text-white/40"
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
                    <div className="p-6 rounded-2xl bg-muted/50 dark:bg-white/[0.02] border border-border dark:border-white/5">
                      <Inbox className="h-10 w-10 text-muted-foreground/40 dark:text-white/20" />
                    </div>
                    <p className="text-sm font-bold text-muted-foreground/50 dark:text-white/30 tracking-tight">{emptyMessage}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, idx) => (
                <TableRow 
                  key={row.id} 
                  className={cn(
                    "group/row relative transition-all duration-300 border-b border-border/50 dark:border-white/[0.02] last:border-0 hover:bg-primary/[0.03]",
                    idx % 2 === 0 ? "bg-transparent" : "bg-muted/20 dark:bg-white/[0.01]"
                  )}
                >
                  {columns.map((col, colIdx) => (
                    <TableCell key={col.key} className="py-5 px-6 relative overflow-hidden">
                      {/* Left Neon Accent Indicator */}
                      {colIdx === 0 && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-0 bg-primary shadow-[0_0_10px_rgba(0,212,255,0.8)] transition-all duration-300 group-hover/row:h-3/5" />
                      )}
                      
                      <div className={cn(
                        "text-sm font-semibold transition-all duration-300",
                        "text-foreground/70 dark:text-white/70 group-hover/row:text-primary group-hover/row:translate-x-1",
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
        <div className="px-2">
          <DataTablePagination 
            page={page}
            limit={limit}
            total={total}
            onPageChange={onPageChange}
            onLimitChange={onLimitChange}
          />
        </div>
      )}
    </div>
  );
}
