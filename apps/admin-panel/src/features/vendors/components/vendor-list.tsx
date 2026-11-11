'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@water-supply-crm/ui';
import { ArrowDown, ArrowUp, ArrowUpDown, Eraser, ExternalLink, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useVendors, useSuspendVendor, useUnsuspendVendor } from '../hooks/use-vendors';
import { VendorForm } from './vendor-form';
import { WipeVendorDialog } from './wipe-vendor-dialog';
import { DeleteVendorDialog } from './delete-vendor-dialog';
import { VendorListFilters } from './vendor-list-filters';
import { VendorLiveBadge, VendorStatusBadge } from './vendor-status-badges';
import { BulkActionBar } from './bulk-action-bar';
import { BulkConfirmDialog, type BulkAction } from './bulk-confirm-dialog';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { DataTable, type DataTableColumn } from '../../../components/shared/data-table';
import type { VendorRow, VendorSort } from '../types';

function SortHeader({ label, col, sort, order, onToggle }: { label: string; col: VendorSort; sort: VendorSort; order: 'asc' | 'desc'; onToggle: (c: VendorSort) => void }) {
  const active = sort === col;
  const Icon = !active ? ArrowUpDown : order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
      aria-label={`Sort by ${label.toLowerCase()}`}
      data-sort-active={active ? order : undefined}
      onClick={() => onToggle(col)}
    >
      {label}
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

export function VendorList({ onAddVendor }: { onAddVendor?: () => void } = {}) {
  const list = useVendors();
  const { data, isLoading, error, refetch, page, setPage, limit, setLimit } = list;
  const { mutate: suspendVendor, isPending: isSuspending } = useSuspendVendor();
  const { mutate: unsuspendVendor, isPending: isUnsuspending } = useUnsuspendVendor();

  const [editTarget, setEditTarget] = useState<VendorRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VendorRow | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<{ id: string; name: string } | null>(null);
  const [wipeTarget, setWipeTarget] = useState<VendorRow | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({}); // id -> name
  const [bulk, setBulk] = useState<BulkAction | null>(null);

  const vendors = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  // Selection is per page: drop it whenever the page or any filter changes.
  const viewKey = `${page}|${limit}|${list.search}|${list.status}|${list.sort}|${list.order}`;
  useEffect(() => {
    setSelected({});
  }, [viewKey]);

  const selectedIds = Object.keys(selected);
  const allOnPage = vendors.length > 0 && vendors.every((v) => selected[v.id] !== undefined);
  const toggleAll = () => setSelected(allOnPage ? {} : Object.fromEntries(vendors.map((v) => [v.id, v.name])));
  const toggleOne = (v: VendorRow) =>
    setSelected((s) => {
      const next = { ...s };
      if (next[v.id] !== undefined) delete next[v.id];
      else next[v.id] = v.name;
      return next;
    });

  const columns: DataTableColumn<VendorRow>[] = [
    {
      key: 'select',
      header: <input type="checkbox" className="h-4 w-4" aria-label="Select all vendors on this page" checked={allOnPage} onChange={toggleAll} />,
      className: 'w-10',
      cell: (v) => <input type="checkbox" className="h-4 w-4" aria-label={`Select ${v.name}`} checked={selected[v.id] !== undefined} onChange={() => toggleOne(v)} />,
    },
    {
      key: 'name',
      header: <SortHeader label="Vendor" col="name" sort={list.sort} order={list.order} onToggle={list.toggleSort} />,
      cell: (v) => (
        <div>
          <Link href={`/vendors/${v.id}`} className="font-medium hover:underline">
            {v.name}
          </Link>
          <div className="font-mono text-xs text-muted-foreground">{v.slug}</div>
        </div>
      ),
    },
    { key: 'admin', header: 'Admin email', cell: (v) => <span className="text-muted-foreground">{v.adminEmail ?? '—'}</span> },
    {
      key: 'customers',
      header: <SortHeader label="Customers" col="customers" sort={list.sort} order={list.order} onToggle={list.toggleSort} />,
      cell: (v) => v._counts?.customers ?? '—',
    },
    { key: 'drivers', header: 'Drivers', cell: (v) => v._counts?.drivers ?? '—' },
    {
      key: 'status',
      header: 'Status',
      cell: (v) => (
        <div className="flex flex-wrap gap-1">
          <VendorStatusBadge isActive={v.isActive} />
          <VendorLiveBadge live={!!v.goLiveAt} />
        </div>
      ),
    },
    {
      key: 'created',
      header: <SortHeader label="Created" col="createdAt" sort={list.sort} order={list.order} onToggle={list.toggleSort} />,
      cell: (v) => <span className="text-muted-foreground">{v.createdAt ? new Date(v.createdAt).toLocaleDateString() : '—'}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[150px]',
      cell: (vendor) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label="Edit vendor" onClick={() => setEditTarget(vendor)}>
            <Pencil className="h-4 w-4" />
          </Button>
          {vendor.isActive !== false ? (
            <Button variant="ghost" size="icon" title="Suspend vendor" aria-label="Suspend vendor" disabled={isSuspending} onClick={() => setSuspendTarget({ id: vendor.id, name: vendor.name })}>
              <Pause className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" title="Reactivate vendor" aria-label="Reactivate vendor" disabled={isUnsuspending} onClick={() => unsuspendVendor(vendor.id)}>
              <Play className="h-4 w-4" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`More actions for ${vendor.name}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/vendors/${vendor.id}`}>
                  <ExternalLink className="mr-2 h-4 w-4" /> Open details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setWipeTarget(vendor)}>
                <Eraser className="mr-2 h-4 w-4" /> Wipe data
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteTarget(vendor)}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete vendor
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const filtered = list.hasFilters;

  return (
    <div className="space-y-3">
      <VendorListFilters search={list.search} status={list.status} onSearch={list.setSearch} onStatus={list.setStatus} />
      <BulkActionBar count={selectedIds.length} onSuspend={() => setBulk('suspend')} onReactivate={() => setBulk('unsuspend')} onClear={() => setSelected({})} />

      <DataTable
        columns={columns}
        rows={vendors}
        rowKey={(v) => v.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => {
          void refetch();
        }}
        empty={
          filtered
            ? {
                title: 'No vendors match your filters',
                description: 'Try a different search or status.',
                action: (
                  <Button variant="outline" onClick={list.clearFilters}>
                    Clear filters
                  </Button>
                ),
              }
            : {
                title: 'No vendors yet',
                description: 'Create your first vendor to get started.',
                action: onAddVendor ? (
                  <Button onClick={onAddVendor}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Vendor
                  </Button>
                ) : undefined,
              }
        }
        pagination={{ page, limit, total, onPageChange: setPage, onLimitChange: setLimit }}
      />

      <VendorForm
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        vendor={editTarget}
      />

      <WipeVendorDialog
        vendor={wipeTarget}
        onOpenChange={(open) => {
          if (!open) setWipeTarget(null);
        }}
      />

      <DeleteVendorDialog
        vendor={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />

      <ConfirmDialog
        open={!!suspendTarget}
        onOpenChange={(open) => {
          if (!open) setSuspendTarget(null);
        }}
        title="Suspend Vendor"
        description={`"${suspendTarget?.name ?? ''}" and all its users will be blocked from signing in or using the app until you reactivate it.`}
        confirmLabel="Suspend"
        onConfirm={() => {
          if (suspendTarget) suspendVendor(suspendTarget.id, { onSuccess: () => setSuspendTarget(null) });
        }}
      />

      <BulkConfirmDialog
        open={!!bulk}
        action={bulk ?? 'suspend'}
        vendors={selectedIds.map((id) => ({ id, name: selected[id] }))}
        onOpenChange={(open) => {
          if (!open) {
            setBulk(null);
            setSelected({});
          }
        }}
      />
    </div>
  );
}
