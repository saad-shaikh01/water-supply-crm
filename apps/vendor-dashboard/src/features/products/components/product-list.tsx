'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2, ToggleLeft, ToggleRight, Package, DollarSign, Search, X, ArrowUpDown } from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger, Badge,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Input,
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useProducts, useDeleteProduct, useToggleProduct } from '../hooks/use-products';
import { useQueryState, parseAsString } from 'nuqs';
import { cn } from '@water-supply-crm/ui';
import { useAuthStore } from '../../../store/auth.store';
import { hasMinRole } from '../../../lib/rbac';

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

  const resetPage = () => setPage(1);

  const activeChips = [
    isActive ? { label: isActive === 'true' ? 'Active' : 'Inactive', clear: () => { resetPage(); setIsActive(null); } } : null,
    sortDir ? { label: sortDir === 'asc' ? 'A→Z' : 'Z→A', clear: () => { resetPage(); setSortDir(null); } } : null,
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  const clearAll = () => { resetPage(); setSearch(null); setIsActive(null); setSortDir(null); };

  const response = (data as { data?: any[]; meta?: { total: number } } | undefined);
  const products = (response?.data ?? []) as Array<{ id: string; name: string; basePrice: number; isActive: boolean; description?: string }>;
  const total = response?.meta?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 bg-card/30 p-4 rounded-2xl border border-border">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => { resetPage(); setSearch(e.target.value || null); }}
            className="pl-9 rounded-xl bg-background/50 border-border h-10"
          />
        </div>
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
        {activeChips.length > 0 && (
          <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground font-semibold underline-offset-2 hover:underline">
            Clear all
          </button>
        )}
      </div>

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
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0 border border-primary/10">
                  <Package className="h-5 w-5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold truncate text-sm">{r.name}</span>
                  <span className="text-[11px] text-muted-foreground truncate italic">{r.description || 'No description'}</span>
                </div>
              </div>
            ) 
          },
          { 
            key: 'price', 
            header: 'Base Price', 
            cell: (r) => (
              <div className="flex items-center gap-1.5 font-mono font-black text-primary">
                <span className="text-xs">₨</span>
                {Number(r.basePrice).toLocaleString()}
              </div>
            ) 
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <Badge 
                variant={r.isActive ? "success" : "outline"}
                className={cn(
                  "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest",
                  !r.isActive && "opacity-50"
                )}
              >
                {r.isActive ? 'Active' : 'Inactive'}
              </Badge>
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
