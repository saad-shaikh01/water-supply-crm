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
    <div className="w-full px-4 py-3">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
        {/* Left Side: Records Info */}
        <div className="flex flex-col sm:flex-row items-center gap-4 text-xs text-muted-foreground/60">
          <p className="font-bold whitespace-nowrap uppercase tracking-wider">
            Showing <span className="text-foreground font-black">{startRange}</span> -{' '}
            <span className="text-foreground font-black">{endRange}</span> of{' '}
            <span className="text-foreground font-black">{total}</span>
          </p>
          
          <div className="hidden lg:flex items-center gap-2 border-l border-border pl-4">
            <p className="font-bold uppercase tracking-wider">Rows</p>
            <Select
              value={limit.toString()}
              onValueChange={(value) => onLimitChange(Number(value))}
            >
              <SelectTrigger className="h-7 w-[65px] rounded-md bg-muted/50 border-border hover:bg-muted transition-colors text-[11px] font-bold">
                <SelectValue placeholder={limit} />
              </SelectTrigger>
              <SelectContent side="top" className="rounded-xl border-border shadow-2xl bg-background/95 backdrop-blur-xl">
                {pageSizeOptions.map((pageSize) => (
                  <SelectItem key={pageSize} value={pageSize.toString()} className="rounded-lg text-xs">
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Right Side: Navigation */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 rounded-md bg-muted/30 border-border hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all disabled:opacity-30"
              onClick={() => onPageChange(1)}
              disabled={page <= 1}
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 rounded-md bg-muted/30 border-border hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all disabled:opacity-30"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex items-center justify-center min-w-[80px] gap-2">
            <div className="flex items-center gap-1.5 bg-muted/30 px-2.5 py-1 rounded-md border border-border">
              <span className="text-xs font-black text-primary tabular-nums">{page}</span>
              <span className="text-[10px] text-muted-foreground/30 font-bold">/</span>
              <span className="text-xs font-black text-foreground/70 tabular-nums">{totalPages || 1}</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 rounded-md bg-muted/30 border-border hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all disabled:opacity-30"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 rounded-md bg-muted/30 border-border hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all disabled:opacity-30"
              onClick={() => onPageChange(totalPages)}
              disabled={page >= totalPages}
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
