'use client';

import { ReactNode } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Button, Skeleton,
} from '@water-supply-crm/ui';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
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
  totalPages?: number;
  onPageChange?: (page: number) => void;
  emptyMessage?: string;
}

export function DataTable<T extends { id: string }>({
  data,
  columns,
  isLoading,
  page = 1,
  totalPages,
  onPageChange,
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
    <div className="space-y-4">
      <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30 border-b border-border/50">
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
      
      {totalPages && totalPages > 1 && onPageChange && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2 py-2">
          <p className="text-xs font-medium text-muted-foreground order-2 sm:order-1">
            Showing Page <span className="text-foreground">{page}</span> of <span className="text-foreground">{totalPages}</span>
          </p>
          <div className="flex items-center gap-1 order-1 sm:order-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 rounded-lg bg-background/50 hover:bg-accent border-border/50 transition-all"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <div className="flex items-center gap-1 px-1">
              {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                // Simple pagination logic for 5 pages
                let pageNum = page;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }

                return (
                  <Button
                    key={i}
                    variant={page === pageNum ? "primary" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-8 w-8 p-0 rounded-lg text-xs font-bold transition-all",
                      page === pageNum ? "shadow-md shadow-primary/20" : "text-muted-foreground hover:bg-accent"
                    )}
                    onClick={() => onPageChange(pageNum)}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 rounded-lg bg-background/50 hover:bg-accent border-border/50 transition-all"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
