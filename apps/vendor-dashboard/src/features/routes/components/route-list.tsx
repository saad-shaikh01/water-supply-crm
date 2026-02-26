'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { useRoutes, useDeleteRoute } from '../hooks/use-routes';
import { useAllVans } from '../../vans/hooks/use-vans';
import { useAuthStore } from '../../../store/auth.store';
import { hasMinRole } from '../../../lib/rbac';

interface RouteListProps {
  onEdit: (route: Record<string, unknown>) => void;
}

export function RouteList({ onEdit }: RouteListProps) {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user ? hasMinRole(user.role, 'VENDOR_ADMIN') : false;
  const {
    data,
    isLoading,
    page,
    setPage,
    limit,
    setLimit,
    search,
    setSearch,
    defaultVanId,
    setDefaultVanId,
  } = useRoutes();
  const { data: vansData } = useAllVans();
  const { mutate: deleteRoute, isPending: isDeleting } = useDeleteRoute();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const response = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const routes = (response?.data ?? []) as Array<{
    id: string;
    name: string;
    defaultVan?: { plateNumber: string; defaultDriver?: { name: string } };
  }>;
  const total = response?.meta?.total ?? 0;
  const vans = ((vansData as any)?.data ?? []) as Array<{ id: string; plateNumber: string }>;
  const selectedVanLabel = vans.find((van) => van.id === defaultVanId)?.plateNumber ?? 'Van';

  const activeChips = [
    search ? { label: `Search: ${search}`, clear: () => { setPage(1); setSearch(null); } } : null,
    defaultVanId ? { label: `Van: ${selectedVanLabel}`, clear: () => { setPage(1); setDefaultVanId(null); } } : null,
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  const clearAll = () => {
    setPage(1);
    setSearch(null);
    setDefaultVanId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 bg-card/30 p-4 rounded-2xl border border-border/50">
        <SearchInput placeholder="Search routes..." onBeforeChange={() => setPage(1)} />

        <Select value={defaultVanId || 'all'} onValueChange={(v) => { setPage(1); setDefaultVanId(v === 'all' ? null : v); }}>
          <SelectTrigger className="w-[180px] rounded-xl bg-background/50 border-border/50 h-10">
            <SelectValue placeholder="All Vans" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Vans</SelectItem>
            {vans.map((van) => (
              <SelectItem key={van.id} value={van.id}>{van.plateNumber}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activeChips.length > 0 && (
          <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground font-semibold underline-offset-2 hover:underline">
            Clear all
          </button>
        )}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {activeChips.map((chip) => (
            <button
              key={chip.label}
              onClick={chip.clear}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
            >
              {chip.label}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      <DataTable
        data={routes}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No routes found"
        columns={[
          { key: 'name', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'van', header: 'Default Van', cell: (r) => r.defaultVan?.plateNumber ?? '-' },
          { key: 'driver', header: 'Default Driver', cell: (r) => r.defaultVan?.defaultDriver?.name ?? '-' },
          {
            key: 'actions', header: '', width: '60px',
            cell: (r) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(r as Record<string, unknown>)}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem onClick={() => setDeleteId(r.id)} className="text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
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
        title="Delete Route"
        description="Are you sure? This action cannot be undone."
        onConfirm={() => { if (deleteId) deleteRoute(deleteId, { onSuccess: () => setDeleteId(null) }); }}
        isLoading={isDeleting}
        confirmLabel="Delete"
      />
    </div>
  );
}
