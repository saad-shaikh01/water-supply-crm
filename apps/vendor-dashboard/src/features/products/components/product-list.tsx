'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2, ToggleLeft, ToggleRight, Package, DollarSign } from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger, Badge
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useProducts, useDeleteProduct, useToggleProduct } from '../hooks/use-products';
import { cn } from '@water-supply-crm/ui';

interface ProductListProps {
  onEdit: (product: Record<string, unknown>) => void;
}

export function ProductList({ onEdit }: ProductListProps) {
  const { data, isLoading, page, setPage, limit, setLimit } = useProducts();
  const { mutate: deleteProduct, isPending: isDeleting } = useDeleteProduct();
  const { mutate: toggleProduct } = useToggleProduct();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const response = (data as { data?: any[]; meta?: { total: number } } | undefined);
  const products = (response?.data ?? []) as Array<{ id: string; name: string; basePrice: number; isActive: boolean; description?: string }>;
  const total = response?.meta?.total ?? 0;

  return (
    <div className="space-y-4">
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
                  <DropdownMenuItem onClick={() => toggleProduct(r.id)} className="rounded-lg cursor-pointer px-2 py-2">
                    {r.isActive
                      ? <><ToggleLeft className="mr-2 h-4 w-4 text-muted-foreground" /> <span className="font-medium text-sm">Deactivate</span></>
                      : <><ToggleRight className="mr-2 h-4 w-4 text-emerald-500" /> <span className="font-medium text-sm text-emerald-500">Activate</span></>
                    }
                  </DropdownMenuItem>
                  <div className="h-[1px] bg-border/50 my-1" />
                  <DropdownMenuItem
                    onClick={() => setDeleteId(r.id)}
                    className="rounded-lg cursor-pointer px-2 py-2 text-destructive focus:text-destructive focus:bg-destructive/10"
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> 
                    <span className="font-medium text-sm">Remove Product</span>
                  </DropdownMenuItem>
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
        description="Are you sure you want to remove this product? This will affect all future daily sheets and reports. This action cannot be undone."
        onConfirm={() => { if (deleteId) deleteProduct(deleteId, { onSuccess: () => setDeleteId(null) }); }}
        isLoading={isDeleting}
        confirmLabel="Remove Product"
      />
    </div>
  );
}
