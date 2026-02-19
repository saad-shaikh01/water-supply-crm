'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryState, parseAsString } from 'nuqs';
import { MoreHorizontal, Pencil, Trash2, Eye, MapPin, Phone, PowerOff, Power } from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { RouteFilter } from '../../../components/shared/filters/route-filter';
import { useCustomers, useDeleteCustomer, useDeactivateCustomer, useReactivateCustomer } from '../hooks/use-customers';
import { CustomerForm } from './customer-form';
import { cn } from '@water-supply-crm/ui';

interface CustomerListProps {
  onAdd?: () => void;
}

export function CustomerList({ onAdd: _ }: CustomerListProps) {
  const { data, isLoading, page, setPage, limit, setLimit } = useCustomers();
  const { mutate: deleteCustomer, isPending: isDeleting } = useDeleteCustomer();
  const { mutate: deactivateCustomer, isPending: isDeactivating } = useDeactivateCustomer();
  const { mutate: reactivateCustomer, isPending: isReactivating } = useReactivateCustomer();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [editCustomer, setEditCustomer] = useState<Record<string, unknown> | null>(null);
  const [paymentType, setPaymentType] = useQueryState('paymentType', parseAsString.withDefault(''));

  const customers = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const rows = (customers?.data ?? []) as Array<{
    id: string;
    name: string;
    phoneNumber: string;
    address: string;
    route?: { name: string };
    financialBalance?: number;
    customerCode: string;
    paymentType?: 'MONTHLY' | 'CASH';
    isActive?: boolean;
  }>;
  const total = customers?.meta?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-card/30 p-4 rounded-2xl border border-border/50">
        <div className="flex-1 w-full">
          <SearchInput placeholder="Search name, phone or code..." />
        </div>
        <RouteFilter />
        <Select value={paymentType || 'all'} onValueChange={(v) => setPaymentType(v === 'all' ? null : v as 'MONTHLY' | 'CASH')}>
          <SelectTrigger className="w-[160px] rounded-xl bg-background/50 border-border/50">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-border/50 shadow-2xl">
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="CASH">Cash</SelectItem>
            <SelectItem value="MONTHLY">Monthly</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No customers found. Start by adding one!"
        columns={[
          {
            key: 'name',
            header: 'Customer',
            cell: (r) => (
              <div className={cn("flex items-center gap-3", !r.isActive && "opacity-60")}>
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">
                  {r.name.charAt(0)}
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold truncate group-hover:text-primary transition-colors">{r.name}</span>
                    {!r.isActive && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground border-muted-foreground/30">
                        INACTIVE
                      </Badge>
                    )}
                  </div>
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
            key: 'paymentType',
            header: 'Type',
            cell: (r) => (
              <Badge className={cn(
                "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border-none",
                r.paymentType === 'MONTHLY'
                  ? "bg-blue-500/10 text-blue-500"
                  : "bg-emerald-500/10 text-emerald-500"
              )}>
                {r.paymentType ?? 'CASH'}
              </Badge>
            )
          },
          {
            key: 'balance',
            header: 'Balance',
            cell: (r) => {
              const balance = Number(r.financialBalance ?? 0);
              const isOwed = balance > 0;
              return (
                <div className={cn(
                  "font-mono font-bold text-sm px-2 py-1 rounded-lg inline-block",
                  isOwed ? "text-destructive bg-destructive/10" : "text-emerald-500 bg-emerald-500/10"
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
                  {r.isActive !== false ? (
                    <DropdownMenuItem
                      onClick={() => setDeactivateId(r.id)}
                      className="rounded-lg cursor-pointer px-2 py-2 text-orange-500 focus:text-orange-500 focus:bg-orange-500/10"
                    >
                      <PowerOff className="mr-2 h-4 w-4" />
                      <span className="font-medium text-sm">Deactivate</span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => reactivateCustomer(r.id)}
                      disabled={isReactivating}
                      className="rounded-lg cursor-pointer px-2 py-2 text-emerald-500 focus:text-emerald-500 focus:bg-emerald-500/10"
                    >
                      <Power className="mr-2 h-4 w-4" />
                      <span className="font-medium text-sm">Reactivate</span>
                    </DropdownMenuItem>
                  )}
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

      <ConfirmDialog
        open={!!deactivateId}
        onOpenChange={(o) => { if (!o) setDeactivateId(null); }}
        title="Deactivate Customer"
        description="This customer will be marked inactive and won't appear in daily sheets. You can reactivate them at any time."
        onConfirm={() => { if (deactivateId) { deactivateCustomer(deactivateId, { onSuccess: () => setDeactivateId(null) }); } }}
        isLoading={isDeactivating}
        confirmLabel="Deactivate"
      />

      <CustomerForm
        open={!!editCustomer}
        onOpenChange={(o) => { if (!o) setEditCustomer(null); }}
        customer={editCustomer}
      />
    </div>
  );
}
