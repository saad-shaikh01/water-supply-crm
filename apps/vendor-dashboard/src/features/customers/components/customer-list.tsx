'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryState, parseAsString, parseAsInteger } from 'nuqs';
import { MoreHorizontal, Pencil, Trash2, Eye, MapPin, Phone, PowerOff, Power, SlidersHorizontal, X, ChevronUp, ChevronDown, ChevronsUpDown, CalendarClock } from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Sheet, SheetContent, SheetHeader, SheetTitle, Label,
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { RouteFilter } from '../../../components/shared/filters/route-filter';
import { VanFilter } from '../../../components/shared/filters/van-filter';
import { useCustomers, useDeleteCustomer, useDeactivateCustomer, useReactivateCustomer, useBulkDeactivateCustomers } from '../hooks/use-customers';
import { CustomerForm } from './customer-form';
import { BulkScheduleUpdateDialog } from './bulk-schedule-update-dialog';
import { cn } from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';

interface CustomerListProps {
  onAdd?: () => void;
}

export function CustomerList({ onAdd: _ }: CustomerListProps) {
  const canUpdate = useCan('customers:update');
  const canDeactivate = useCan('customers:deactivate');
  const canRestore = useCan('customers:restore');
  const canDelete = useCan('customers:delete');
  const { data, isLoading, page, setPage, limit, setLimit, isActive, setIsActive, hasPortalAccess, setHasPortalAccess, sort, setSort, sortDir, setSortDir } = useCustomers();
  const { mutate: deleteCustomer, isPending: isDeleting } = useDeleteCustomer();
  const { mutate: deactivateCustomer, isPending: isDeactivating } = useDeactivateCustomer();
  const { mutate: reactivateCustomer, isPending: isReactivating } = useReactivateCustomer();
  const { mutate: bulkDeactivate, isPending: isBulkDeactivating } = useBulkDeactivateCustomers();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [reactivateId, setReactivateId] = useState<string | null>(null);
  const [editCustomer, setEditCustomer] = useState<Record<string, unknown> | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkScheduleOpen, setBulkScheduleOpen] = useState(false);
  const [bulkDeactivateOpen, setBulkDeactivateOpen] = useState(false);
  const [paymentType, setPaymentType] = useQueryState('paymentType', parseAsString.withDefault(''));
  const [vanId, setVanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [dayOfWeek, setDayOfWeek] = useQueryState('dayOfWeek', parseAsInteger.withDefault(0));

  const DAY_NAMES: Record<number, string> = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };

  // Reset to page 1 whenever any filter changes
  const resetPage = () => setPage(1);

  const handleSort = (field: string) => {
    resetPage();
    if (sort !== field) {
      setSort(field);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else {
      setSort(null);
      setSortDir(null);
    }
  };

  const activeFilters = [
    paymentType ? { label: `Type: ${paymentType}`, clear: () => { resetPage(); setPaymentType(null); } } : null,
    isActive !== 'all' ? { label: isActive === 'true' ? 'Active' : 'Inactive', clear: () => { resetPage(); setIsActive('all'); } } : null,
    hasPortalAccess !== 'all' ? { label: hasPortalAccess === 'true' ? 'Portal: Activated' : 'Portal: Not Activated', clear: () => { resetPage(); setHasPortalAccess('all'); } } : null,
    dayOfWeek ? { label: `Day: ${DAY_NAMES[dayOfWeek] ?? dayOfWeek}`, clear: () => { resetPage(); setDayOfWeek(null); } } : null,
    vanId ? { label: 'Van filter', clear: () => { resetPage(); setVanId(null); } } : null,
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  const clearAllFilters = () => {
    resetPage();
    setPaymentType(null);
    setIsActive('all');
    setHasPortalAccess('all');
    setDayOfWeek(null);
    setVanId(null);
  };

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
    isBillingExempt?: boolean;
    userId?: string | null;
    deliverySchedules?: Array<{ dayOfWeek: number; van?: { plateNumber: string } }>;
    wallets?: Array<{ balance?: number; product?: { name?: string } }>;
  }>;
  const total = customers?.meta?.total ?? 0;

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllOnPage = () => {
    const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => (allSelected ? next.delete(r.id) : next.add(r.id)));
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Primary filter bar */}
      <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 bg-card/30 p-3 sm:p-4 rounded-2xl border border-border">
        <div className="flex-1 w-full">
          <SearchInput placeholder="Search name, phone or code..." onBeforeChange={resetPage} />
        </div>
        <div className="hidden sm:block">
          <RouteFilter onBeforeChange={resetPage} />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiltersOpen(true)}
          className={cn(
            "rounded-xl h-9 sm:h-10 px-3 sm:px-4 gap-2 font-semibold shrink-0 w-full sm:w-auto",
            activeFilters.length > 0 && "border-primary text-primary"
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeFilters.length > 0 && (
            <Badge className="h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px] font-black">
              {activeFilters.length}
            </Badge>
          )}
        </Button>
      </div>

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {activeFilters.map((f) => (
            <button
              key={f.label}
              onClick={f.clear}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
            >
              {f.label}
              <X className="h-3 w-3" />
            </button>
          ))}
          <button
            onClick={clearAllFilters}
            className="text-xs text-muted-foreground hover:text-foreground font-semibold underline-offset-2 hover:underline transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* More Filters drawer */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm bg-background/95 backdrop-blur-xl border-l border-border">
          <SheetHeader className="pb-6 border-b border-border">
            <SheetTitle className="flex items-center gap-2 text-lg font-bold">
              <SlidersHorizontal className="h-5 w-5 text-primary" /> More Filters
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-6 py-6">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Route</Label>
              <RouteFilter onBeforeChange={resetPage} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Payment Type</Label>
              <Select value={paymentType || 'all'} onValueChange={(v) => { resetPage(); setPaymentType(v === 'all' ? null : v as 'MONTHLY' | 'CASH'); }}>
                <SelectTrigger className="rounded-xl bg-background/50 border-border h-10">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border shadow-2xl">
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</Label>
              <Select value={isActive} onValueChange={(v) => { resetPage(); setIsActive(v); }}>
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
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Portal Access</Label>
              <Select value={hasPortalAccess} onValueChange={(v) => { resetPage(); setHasPortalAccess(v); }}>
                <SelectTrigger className="rounded-xl bg-background/50 border-border h-10">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border shadow-2xl">
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="true">Activated</SelectItem>
                  <SelectItem value="false">Not Activated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Delivery Day</Label>
              <Select
                value={dayOfWeek ? String(dayOfWeek) : 'all'}
                onValueChange={(v) => { resetPage(); setDayOfWeek(v === 'all' ? null : Number(v)); }}
              >
                <SelectTrigger className="rounded-xl bg-background/50 border-border h-10">
                  <SelectValue placeholder="All Days" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border shadow-2xl">
                  <SelectItem value="all">All Days</SelectItem>
                  {Object.entries(DAY_NAMES).map(([val, name]) => (
                    <SelectItem key={val} value={val}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Van</Label>
              <VanFilter onBeforeChange={resetPage} />
            </div>
          </div>
          {activeFilters.length > 0 && (
            <div className="border-t pt-4">
              <Button variant="ghost" className="w-full rounded-xl text-muted-foreground" onClick={() => { clearAllFilters(); setFiltersOpen(false); }}>
                <X className="h-4 w-4 mr-2" /> Clear All Filters
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Bulk action bar */}
      {(canUpdate || canDeactivate) && selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 bg-primary/5 border border-primary/20 rounded-2xl px-4 py-3">
          <span className="text-sm font-semibold text-primary">
            {selectedIds.size} customer{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
            {canDeactivate && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkDeactivateOpen(true)}
                className="gap-1.5 border-orange-500/40 text-orange-500 hover:bg-orange-500/10 hover:text-orange-500"
              >
                <PowerOff className="h-4 w-4" />
                Deactivate
              </Button>
            )}
            {canUpdate && (
              <Button size="sm" onClick={() => setBulkScheduleOpen(true)} className="gap-1.5">
                <CalendarClock className="h-4 w-4" />
                Bulk Schedule Update
              </Button>
            )}
          </div>
        </div>
      )}

      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        sortKey={sort}
        sortDir={sortDir}
        onSort={handleSort}
        emptyMessage="No customers found. Start by adding one!"
        selectable={canUpdate || canDeactivate}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleAll={toggleAllOnPage}
        columns={[
          {
            key: 'name',
            header: (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSort('name')}
                  className={cn(
                    "flex items-center gap-0.5 text-[10px] uppercase tracking-[0.25em] font-bold hover:text-foreground transition-colors",
                    sort === 'name' ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  Name
                  {sort === 'name' && sortDir === 'asc' && <ChevronUp className="h-3 w-3" />}
                  {sort === 'name' && sortDir === 'desc' && <ChevronDown className="h-3 w-3" />}
                  {sort !== 'name' && <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                </button>
                <span className="text-muted-foreground/30">/</span>
                <button
                  onClick={() => handleSort('customerCode')}
                  className={cn(
                    "flex items-center gap-0.5 text-[10px] uppercase tracking-[0.25em] font-bold hover:text-foreground transition-colors",
                    sort === 'customerCode' ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  Code
                  {sort === 'customerCode' && sortDir === 'asc' && <ChevronUp className="h-3 w-3" />}
                  {sort === 'customerCode' && sortDir === 'desc' && <ChevronDown className="h-3 w-3" />}
                  {sort !== 'customerCode' && <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                </button>
              </div>
            ),
            cell: (r) => (
              <div className={cn("flex items-center gap-3 max-w-[220px]", !r.isActive && "opacity-60")}>
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0 text-xs">
                  {r.name.charAt(0)}
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/dashboard/customers/${r.id}`} className="font-bold truncate text-sm text-foreground dark:text-white hover:text-primary hover:underline transition-colors">{r.name}</Link>
                    {!r.isActive && (
                      <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 text-muted-foreground border-muted-foreground/20 shrink-0">
                        OFF
                      </Badge>
                    )}
                  </div>
                  <span className="text-[14px] font-mono font-semibold text-primary/70 truncate">{r.customerCode}</span>
                </div>
              </div>
            )
          },
          {
            key: 'phone',
            header: 'Contact',
            cell: (r) => (
              <div className="flex items-center gap-2 text-muted-foreground/80 whitespace-nowrap">
                <Phone className="h-3 w-3 shrink-0" />
                <span className="text-xs font-medium tabular-nums">{r.phoneNumber}</span>
              </div>
            )
          },
          {
            key: 'payment',
            header: 'Payment',
            sortable: true,
            sortField: 'financialBalance',
            cell: (r) => {
              const balance = Number(r.financialBalance ?? 0);
              const isOwed = balance > 0;
              return (
                <div className={cn(
                  "font-mono font-bold text-xs px-2 py-1 rounded-md inline-block whitespace-nowrap",
                  isOwed ? "text-rose-400 bg-rose-500/10" : "text-emerald-400 bg-emerald-500/10"
                )}>
                  ₨ {balance.toLocaleString()}
                </div>
              );
            }
          },
          {
            key: 'bottleBalance',
            header: 'Bottle Balance',
            cell: (r) => {
              const wallets = (r.wallets ?? []).filter((w) => Number(w.balance ?? 0) !== 0);
              const total = wallets.reduce((s, w) => s + Number(w.balance ?? 0), 0);
              if (wallets.length === 0) return <span className="text-xs text-muted-foreground/40">—</span>;
              return (
                <div className="flex flex-col gap-0.5">
                  <span className={cn(
                    "font-mono font-bold text-xs",
                    total < 0 ? "text-rose-400" : "text-foreground dark:text-white"
                  )}>
                    {total} btl
                  </span>
                  {wallets.length > 1 && (
                    <span className="text-[9px] text-muted-foreground/60 truncate max-w-[140px]">
                      {wallets.map((w) => `${w.product?.name ?? '—'}: ${Number(w.balance ?? 0)}`).join(', ')}
                    </span>
                  )}
                </div>
              );
            }
          },
          {
            key: 'address',
            header: 'Location',
            cell: (r) => (
              <div className="flex items-center gap-2 text-muted-foreground/70 max-w-[180px]">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="text-xs truncate">{r.address}</span>
              </div>
            )
          },
          {
            key: 'deliveryDays',
            header: 'Delivery Days',
            cell: (r) => {
              const DAY_SHORT: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
              const schedules = r.deliverySchedules ?? [];
              if (schedules.length === 0) return <span className="text-xs text-muted-foreground/40">—</span>;

              return (
                <div className="flex flex-wrap items-center gap-1">
                  {schedules.map((s, i) => (
                    <Badge key={i} variant="secondary" className="text-[9px] font-bold px-1.5 py-0 bg-primary/10 text-primary border-primary/20 rounded-md whitespace-nowrap">
                      {DAY_SHORT[s.dayOfWeek] ?? s.dayOfWeek}
                      {s.van?.plateNumber && <span className="ml-1 text-primary/60">· {s.van.plateNumber}</span>}
                    </Badge>
                  ))}
                </div>
              );
            }
          },
          {
            key: 'paymentType',
            header: 'Type',
            cell: (r) => (
              <div className="flex flex-col gap-1">
                <Badge className={cn(
                  "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border-none whitespace-nowrap",
                  r.paymentType === 'MONTHLY'
                    ? "bg-indigo-500/10 text-indigo-400"
                    : "bg-emerald-500/10 text-emerald-400"
                )}>
                  {r.paymentType ?? 'CASH'}
                </Badge>
                {r.isBillingExempt && (
                  <Badge className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border-none whitespace-nowrap bg-amber-500/10 text-amber-500">
                    Free
                  </Badge>
                )}
              </div>
            )
          },
          // Portal column hidden for now — uncomment to restore
          // {
          //   key: 'portal',
          //   header: 'Portal',
          //   cell: (r) => (
          //     <Badge className={cn(
          //       "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border-none whitespace-nowrap",
          //       r.userId ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
          //     )}>
          //       {r.userId ? 'Activated' : 'Not Activated'}
          //     </Badge>
          //   )
          // },
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
                  {canUpdate && (
                    <DropdownMenuItem onClick={() => setEditCustomer(r as Record<string, unknown>)} className="rounded-lg cursor-pointer px-2 py-2">
                      <Pencil className="mr-2 h-4 w-4 text-orange-500" />
                      <span className="font-medium text-sm">Edit Details</span>
                    </DropdownMenuItem>
                  )}
                  {(canDeactivate || canRestore || canDelete) && <div className="h-[1px] bg-border/50 my-1" />}
                  {r.isActive !== false ? (canDeactivate && (
                    <DropdownMenuItem
                      onClick={() => setDeactivateId(r.id)}
                      className="rounded-lg cursor-pointer px-2 py-2 text-orange-500 focus:text-orange-500 focus:bg-orange-500/10"
                    >
                      <PowerOff className="mr-2 h-4 w-4" />
                      <span className="font-medium text-sm">Deactivate</span>
                    </DropdownMenuItem>
                  )) : (canRestore && (
                    <DropdownMenuItem
                      onClick={() => setReactivateId(r.id)}
                      className="rounded-lg cursor-pointer px-2 py-2 text-emerald-500 focus:text-emerald-500 focus:bg-emerald-500/10"
                    >
                      <Power className="mr-2 h-4 w-4" />
                      <span className="font-medium text-sm">Reactivate</span>
                    </DropdownMenuItem>
                  ))}
                  {canDelete && (
                    <DropdownMenuItem
                      onClick={() => setDeleteId(r.id)}
                      className="rounded-lg cursor-pointer px-2 py-2 text-destructive focus:text-destructive focus:bg-destructive/10"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      <span className="font-medium text-sm">Delete Customer</span>
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

      <ConfirmDialog
        open={!!reactivateId}
        onOpenChange={(o) => { if (!o) setReactivateId(null); }}
        title="Reactivate Customer"
        description="This customer will be marked active again and will appear in daily sheets and delivery planning."
        onConfirm={() => { if (reactivateId) { reactivateCustomer(reactivateId, { onSuccess: () => setReactivateId(null) }); } }}
        isLoading={isReactivating}
        confirmLabel="Reactivate"
      />

      <CustomerForm
        open={!!editCustomer}
        onOpenChange={(o) => { if (!o) setEditCustomer(null); }}
        customer={editCustomer}
      />

      <BulkScheduleUpdateDialog
        open={bulkScheduleOpen}
        onOpenChange={setBulkScheduleOpen}
        customerIds={[...selectedIds]}
        onSuccess={() => setSelectedIds(new Set())}
      />

      <ConfirmDialog
        open={bulkDeactivateOpen}
        onOpenChange={setBulkDeactivateOpen}
        title="Deactivate Selected Customers"
        description={`Deactivate ${selectedIds.size} selected customer${selectedIds.size !== 1 ? 's' : ''}? They won't appear in daily sheets. Any customer with pending deliveries or outstanding bottles is skipped automatically. You can reactivate them individually at any time.`}
        onConfirm={() => {
          bulkDeactivate([...selectedIds], {
            onSuccess: () => { setBulkDeactivateOpen(false); setSelectedIds(new Set()); },
            onError: () => setBulkDeactivateOpen(false),
          });
        }}
        isLoading={isBulkDeactivating}
        confirmLabel="Deactivate"
      />
    </div>
  );
}
