'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger,
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useProducts, useDeleteProduct, useToggleProduct } from '../hooks/use-products';

interface ProductListProps {
  onEdit: (product: Record<string, unknown>) => void;
}

export function ProductList({ onEdit }: ProductListProps) {
  const { data, isLoading } = useProducts();
  const { mutate: deleteProduct, isPending: isDeleting } = useDeleteProduct();
  const { mutate: toggleProduct } = useToggleProduct();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const products = (data ?? []) as Array<{ id: string; name: string; price: number; unit: string; isActive: boolean }>;

  return (
    <div>
      <DataTable
        data={products}
        isLoading={isLoading}
        emptyMessage="No products found"
        columns={[
          { key: 'name', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'price', header: 'Price', cell: (r) => `$${Number(r.price).toFixed(2)}` },
          { key: 'unit', header: 'Unit', cell: (r) => r.unit },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} />,
          },
          {
            key: 'actions',
            header: '',
            width: '60px',
            cell: (r) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(r as Record<string, unknown>)}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleProduct(r.id)}>
                    {r.isActive
                      ? <><ToggleLeft className="mr-2 h-4 w-4" /> Deactivate</>
                      : <><ToggleRight className="mr-2 h-4 w-4" /> Activate</>
                    }
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeleteId(r.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
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
        description="Are you sure? This action cannot be undone."
        onConfirm={() => { if (deleteId) deleteProduct(deleteId, { onSuccess: () => setDeleteId(null) }); }}
        isLoading={isDeleting}
        confirmLabel="Delete"
      />
    </div>
  );
}
