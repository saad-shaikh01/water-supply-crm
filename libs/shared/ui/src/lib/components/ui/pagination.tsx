'use client';

import * as React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { Button } from './button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';

interface DataTablePaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  pageSizeOptions?: number[];
}

export function DataTablePagination({
  page,
  limit,
  total,
  onPageChange,
  onLimitChange,
  pageSizeOptions = [10, 20, 50, 100],
}: DataTablePaginationProps) {
  const totalPages = Math.ceil(total / (limit || 1));
  const startRange = total === 0 ? 0 : (page - 1) * limit + 1;
  const endRange = Math.min(page * limit, total);

  return (
    <div className="sticky bottom-0 z-20 w-full border-t border-border/50 bg-background/95 backdrop-blur-xl px-4 py-3 shadow-[0_-8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_-8px_30px_rgb(0,0,0,0.1)]">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 max-w-[1600px] mx-auto">
        {/* Left Side: Records Info */}
        <div className="flex flex-col sm:flex-row items-center gap-4 text-sm text-muted-foreground">
          <p className="font-medium whitespace-nowrap">
            Showing <span className="text-foreground font-bold">{startRange}</span> to{' '}
            <span className="text-foreground font-bold">{endRange}</span> of{' '}
            <span className="text-foreground font-bold">{total}</span> records
          </p>
          
          <div className="hidden md:flex items-center gap-2 border-l border-border/50 pl-4">
            <p className="text-xs font-medium">Rows per page</p>
            <Select
              value={limit.toString()}
              onValueChange={(value) => onLimitChange(Number(value))}
            >
              <SelectTrigger className="h-8 w-[70px] rounded-lg bg-background/50 border-border/50 hover:bg-accent transition-colors">
                <SelectValue placeholder={limit} />
              </SelectTrigger>
              <SelectContent side="top" className="rounded-xl border-border/50 shadow-2xl">
                {pageSizeOptions.map((pageSize) => (
                  <SelectItem key={pageSize} value={pageSize.toString()} className="rounded-lg">
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Right Side: Navigation */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg bg-background/50 border-border/50 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all disabled:opacity-30"
              onClick={() => onPageChange(1)}
              disabled={page <= 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg bg-background/50 border-border/50 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all disabled:opacity-30"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center justify-center min-w-[100px] gap-2">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Page</span>
            <div className="flex items-center gap-1 bg-muted/50 px-2 py-1 rounded-lg border border-border/50">
              <span className="text-sm font-bold text-primary">{page}</span>
              <span className="text-xs text-muted-foreground/50">/</span>
              <span className="text-sm font-bold text-foreground">{totalPages || 1}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg bg-background/50 border-border/50 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all disabled:opacity-30"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg bg-background/50 border-border/50 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all disabled:opacity-30"
              onClick={() => onPageChange(totalPages)}
              disabled={page >= totalPages}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
