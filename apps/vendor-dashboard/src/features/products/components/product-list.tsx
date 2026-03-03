'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2, ToggleLeft, ToggleRight, Package, DollarSign, Search, X, ArrowUpDown } from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger, Badge,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Input, Sheet, SheetContent, SheetHeader, SheetTitle, Label,
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { StatusBadge } from '../../../components/shared/status-badge';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { useProducts, useDeleteProduct, useToggleProduct } from '../hooks/use-products';
import { useQueryState, parseAsString } from 'nuqs';
import { cn } from '@water-supply-crm/ui';
import { useAuthStore } from '../../../store/auth.store';
import { hasMinRole } from '../../../lib/rbac';
import { SlidersHorizontal } from 'lucide-react';

interface ProductListProps {
  onEdit: (product: Record<string, unknown>) => void;
}

export function ProductList({ onEdit }: ProductListProps) {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user ? hasMinRole(user.role, 'VENDOR_ADMIN') : false;
  const { data, isLoading, page, setPage, limit, setLimit } = useProducts();
  const { mutate: deleteProduct, isPending: isDeleting } = useDeleteProduct();
  const { mutate: toggleProduct } = useToggleProduct();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));
  const [isActive, setIsActive] = useQueryState('isActive', parseAsString.withDefault(''));
  const [sortDir, setSortDir] = useQueryState('sortDir', parseAsString.withDefault(''));
  const [filtersOpen, setFiltersOpen] = useState(false);

  const resetPage = () => setPage(1);

  const activeChips = [
    isActive ? { label: isActive === 'true' ? 'Active' : 'Inactive', clear: () => { resetPage(); setIsActive(null); } } : null,
    sortDir ? { label: sortDir === 'asc' ? 'A→Z' : 'Z→A', clear: () => { resetPage(); setSortDir(null); } } : null,
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  const activeFilterCount = activeChips.length;

  const clearAll = () => { resetPage(); setSearch(null); setIsActive(null); setSortDir(null); };

  const response = (data as { data?: any[]; meta?: { total: number } } | undefined);
  const products = (response?.data ?? []) as Array<{ id: string; name: string; basePrice: number; isActive: boolean; description?: string }>;
  const total = response?.meta?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 bg-card/30 p-3 sm:p-4 rounded-2xl border border-border">
        <div className="flex-1 w-full">
          <SearchInput placeholder="Search products..." onBeforeChange={resetPage} />
        </div>
        <div className="hidden sm:flex items-center gap-3">
          <Select value={isActive || 'all'} onValueChange={(v) => { resetPage(); setIsActive(v === 'all' ? null : v); }}>
            <SelectTrigger className="w-[130px] rounded-xl bg-background/50 border-border h-10">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="true">Active</SelectItem>
              <SelectItem value="false">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortDir || 'none'} onValueChange={(v) => { resetPage(); setSortDir(v === 'none' ? null : v); }}>
            <SelectTrigger className="w-[110px] rounded-xl bg-background/50 border-border h-10">
              <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 shrink-0" />
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Default</SelectItem>
              <SelectItem value="asc">A → Z</SelectItem>
              <SelectItem value="desc">Z → A</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiltersOpen(true)}
          className={cn(
            "rounded-xl h-9 sm:h-10 px-3 sm:px-4 gap-2 font-semibold shrink-0 w-full sm:w-auto sm:hidden",
            activeFilterCount > 0 && "border-primary text-primary"
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge className="h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px] font-black">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* More Filters drawer (Mobile Only) */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm bg-background/95 backdrop-blur-xl border-l border-border">
          <SheetHeader className="pb-6 border-b border-border">
            <SheetTitle className="flex items-center gap-2 text-lg font-bold">
              <SlidersHorizontal className="h-5 w-5 text-primary" /> Filters
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-6 py-6">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</Label>
              <Select value={isActive || 'all'} onValueChange={(v) => { resetPage(); setIsActive(v === 'all' ? null : v); }}>
                <SelectTrigger className="rounded-xl bg-background/50 border-border h-10">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border shadow-2xl">
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Sort Order</Label>
              <Select value={sortDir || 'none'} onValueChange={(v) => { resetPage(); setSortDir(v === 'none' ? null : v); }}>
                <SelectTrigger className="rounded-xl bg-background/50 border-border h-10">
                  <SelectValue placeholder="Default Sort" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border shadow-2xl">
                  <SelectItem value="none">Default</SelectItem>
                  <SelectItem value="asc">A → Z</SelectItem>
                  <SelectItem value="desc">Z → A</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="border-t pt-4">
              <Button variant="ghost" className="w-full rounded-xl text-muted-foreground" onClick={() => { clearAll(); setFiltersOpen(false); }}>
                <X className="h-4 w-4 mr-2" /> Clear All Filters
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Active chips */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {activeChips.map((chip) => (
            <button key={chip.label} onClick={chip.clear}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors">
              {chip.label} <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      <DataTable
        data={products}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No products in inventory. Add your first product!"
        columns={[
          { 
            key: 'name', 
            header: 'Product', 
            cell: (r) => (
              <div className="flex items-center gap-3 max-w-[250px]">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 border border-primary/10">
                  <Package className="h-4 w-4" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold truncate text-sm text-white">{r.name}</span>
                  <span className="text-[10px] text-muted-foreground/60 truncate italic">{r.description || 'No description'}</span>
                </div>
              </div>
            ) 
          },
          { 
            key: 'price', 
            header: 'Base Price', 
            cell: (r) => (
              <div className="flex items-center gap-1 font-mono font-bold text-indigo-400 whitespace-nowrap">
                <span className="text-[10px] opacity-60">₨</span>
                {Number(r.basePrice).toLocaleString()}
              </div>
            ) 
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <div className="scale-90 origin-left">
                <Badge 
                  variant={r.isActive ? "success" : "outline"}
                  className={cn(
                    "px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider",
                    !r.isActive && "opacity-40"
                  )}
                >
                  {r.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            ),
          },
          {
            key: 'actions',
            header: '',
            width: '60px',
            cell: (r) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="hover:bg-accent rounded-full transition-all">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 p-1.5 rounded-xl border-border/50 bg-background/95 backdrop-blur-xl">
                  <DropdownMenuItem onClick={() => onEdit(r as Record<string, unknown>)} className="rounded-lg cursor-pointer px-2 py-2">
                    <Pencil className="mr-2 h-4 w-4 text-orange-500" /> 
                    <span className="font-medium text-sm">Edit Product</span>
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem onClick={() => toggleProduct(r.id)} className="rounded-lg cursor-pointer px-2 py-2">
                      {r.isActive
                        ? <><ToggleLeft className="mr-2 h-4 w-4 text-muted-foreground" /> <span className="font-medium text-sm">Deactivate</span></>
                        : <><ToggleRight className="mr-2 h-4 w-4 text-emerald-500" /> <span className="font-medium text-sm text-emerald-500">Activate</span></>
                      }
                    </DropdownMenuItem>
                  )}
                  {isAdmin && <div className="h-[1px] bg-border/50 my-1" />}
                  {isAdmin && (
                    <DropdownMenuItem
                      onClick={() => setDeleteId(r.id)}
                      className="rounded-lg cursor-pointer px-2 py-2 text-destructive focus:text-destructive focus:bg-destructive/10"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      <span className="font-medium text-sm">Remove Product</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="Delete Product"
        description="Delete only if this product has no delivery history or orders. If records exist, deactivate it instead. This action cannot be undone."
        onConfirm={() => { if (deleteId) deleteProduct(deleteId, { onSuccess: () => setDeleteId(null) }); }}
        isLoading={isDeleting}
        confirmLabel="Remove Product"
      />
    </div>
  );
}
