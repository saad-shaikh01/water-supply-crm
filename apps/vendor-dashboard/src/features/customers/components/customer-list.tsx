'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal, Pencil, Trash2, Eye } from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { RouteFilter } from '../../../components/shared/filters/route-filter';
import { useCustomers, useDeleteCustomer } from '../hooks/use-customers';
import { CustomerForm } from './customer-form';

interface CustomerListProps {
  onAdd?: () => void;
}

export function CustomerList({ onAdd: _ }: CustomerListProps) {
  const { data, isLoading, page } = useCustomers();
  const { mutate: deleteCustomer, isPending: isDeleting } = useDeleteCustomer();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editCustomer, setEditCustomer] = useState<Record<string, unknown> | null>(null);

  const customers = (data as { data?: unknown[]; total?: number; totalPages?: number } | undefined);
  const rows = (customers?.data ?? []) as Array<{ id: string; name: string; phone: string; address: string; route?: { name: string }; walletBalance?: number }>;
  const totalPages = customers?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SearchInput placeholder="Search customers..." />
        <RouteFilter />
      </div>
      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        totalPages={totalPages}
        emptyMessage="No customers found"
        columns={[
          { key: 'name', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'phone', header: 'Phone', cell: (r) => r.phone },
          { key: 'address', header: 'Address', cell: (r) => r.address },
          { key: 'route', header: 'Route', cell: (r) => r.route?.name ?? '—' },
          { key: 'balance', header: 'Balance', cell: (r) => `$${Number(r.walletBalance ?? 0).toFixed(2)}` },
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
                  <DropdownMenuItem asChild>
                    <Link href={`/dashboard/customers/${r.id}`} className="flex items-center">
                      <Eye className="mr-2 h-4 w-4" /> View
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setEditCustomer(r as Record<string, unknown>)}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit
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
        title="Delete Customer"
        description="Are you sure? This action cannot be undone."
        onConfirm={() => { if (deleteId) { deleteCustomer(deleteId, { onSuccess: () => setDeleteId(null) }); } }}
        isLoading={isDeleting}
        confirmLabel="Delete"
      />
      <CustomerForm
        open={!!editCustomer}
        onOpenChange={(o) => { if (!o) setEditCustomer(null); }}
        customer={editCustomer}
      />
    </div>
  );
}
