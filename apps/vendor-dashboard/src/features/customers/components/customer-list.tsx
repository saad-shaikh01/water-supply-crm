'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal, Pencil, Trash2, Eye, MapPin, Phone, User } from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, Badge
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { RouteFilter } from '../../../components/shared/filters/route-filter';
import { useCustomers, useDeleteCustomer } from '../hooks/use-customers';
import { CustomerForm } from './customer-form';
import { cn } from '@water-supply-crm/ui';

interface CustomerListProps {
  onAdd?: () => void;
}

export function CustomerList({ onAdd: _ }: CustomerListProps) {
  const { data, isLoading, page, setPage } = useCustomers();
  const { mutate: deleteCustomer, isPending: isDeleting } = useDeleteCustomer();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editCustomer, setEditCustomer] = useState<Record<string, unknown> | null>(null);

  const customers = (data as { data?: unknown[]; total?: number; totalPages?: number } | undefined);
  const rows = (customers?.data ?? []) as Array<{ id: string; name: string; phoneNumber: string; address: string; route?: { name: string }; walletBalance?: number; customerCode: string }>;
  const totalPages = customers?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-card/30 p-4 rounded-2xl border border-border/50">
        <SearchInput placeholder="Search name, phone or code..." />
        <RouteFilter />
      </div>

      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage="No customers found. Start by adding one!"
        columns={[
          { 
            key: 'name', 
            header: 'Customer', 
            cell: (r) => (
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">
                  {r.name.charAt(0)}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold truncate group-hover:text-primary transition-colors">{r.name}</span>
                  <span className="text-[10px] uppercase tracking-tighter text-muted-foreground font-mono">{r.customerCode}</span>
                </div>
              </div>
            ) 
          },
          { 
            key: 'phone', 
            header: 'Contact', 
            cell: (r) => (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-3 w-3" />
                <span className="text-xs font-medium">{r.phoneNumber}</span>
              </div>
            ) 
          },
          { 
            key: 'address', 
            header: 'Location', 
            cell: (r) => (
              <div className="flex items-center gap-2 text-muted-foreground max-w-[200px]">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="text-xs truncate">{r.address}</span>
              </div>
            ) 
          },
          { 
            key: 'route', 
            header: 'Route', 
            cell: (r) => (
              <Badge variant="secondary" className="bg-accent/50 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border-none">
                {r.route?.name ?? 'Unassigned'}
              </Badge>
            ) 
          },
          { 
            key: 'balance', 
            header: 'Balance', 
            cell: (r) => {
              const balance = Number(r.walletBalance ?? 0);
              const isNegative = balance > 0; // In this system, positive balance usually means they owe money
              return (
                <div className={cn(
                  "font-mono font-bold text-sm px-2 py-1 rounded-lg inline-block",
                  isNegative ? "text-destructive bg-destructive/10" : "text-emerald-500 bg-emerald-500/10"
                )}>
                  ₨ {balance.toLocaleString()}
                </div>
              );
            } 
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
                  <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
                    <Link href={`/dashboard/customers/${r.id}`} className="flex items-center px-2 py-2">
                      <Eye className="mr-2 h-4 w-4 text-primary" /> 
                      <span className="font-medium text-sm">View Profile</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setEditCustomer(r as Record<string, unknown>)} className="rounded-lg cursor-pointer px-2 py-2">
                    <Pencil className="mr-2 h-4 w-4 text-orange-500" /> 
                    <span className="font-medium text-sm">Edit Details</span>
                  </DropdownMenuItem>
                  <div className="h-[1px] bg-border/50 my-1" />
                  <DropdownMenuItem
                    onClick={() => setDeleteId(r.id)}
                    className="rounded-lg cursor-pointer px-2 py-2 text-destructive focus:text-destructive focus:bg-destructive/10"
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> 
                    <span className="font-medium text-sm">Delete Customer</span>
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
        description="Are you sure you want to delete this customer? All their history and wallet data will be permanently removed. This action cannot be undone."
        onConfirm={() => { if (deleteId) { deleteCustomer(deleteId, { onSuccess: () => setDeleteId(null) }); } }}
        isLoading={isDeleting}
        confirmLabel="Delete Customer"
      />
      
      <CustomerForm
        open={!!editCustomer}
        onOpenChange={(o) => { if (!o) setEditCustomer(null); }}
        customer={editCustomer}
      />
    </div>
  );
}
