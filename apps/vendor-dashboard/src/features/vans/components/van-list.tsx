'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2, PowerOff, Power, Search, X } from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Badge,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Input,
  Sheet, SheetContent, SheetHeader, SheetTitle, Label,
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { useVans, useDeleteVan, useDeactivateVan, useReactivateVan } from '../hooks/use-vans';
import { useQueryState, parseAsString } from 'nuqs';
import { cn } from '@water-supply-crm/ui';
import { useAuthStore } from '../../../store/auth.store';
import { hasMinRole } from '../../../lib/rbac';
import { SlidersHorizontal } from 'lucide-react';

interface VanListProps {
  onEdit: (van: Record<string, unknown>) => void;
}

export function VanList({ onEdit }: VanListProps) {
  const { data, isLoading, page, setPage, limit, setLimit } = useVans();
  const { mutate: deleteVan, isPending: isDeleting } = useDeleteVan();
  const { mutate: deactivateVan, isPending: isDeactivating } = useDeactivateVan();
  const { mutate: reactivateVan, isPending: isReactivating } = useReactivateVan();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));
  const [isActive, setIsActive] = useQueryState('isActive', parseAsString.withDefault(''));
  const [filtersOpen, setFiltersOpen] = useState(false);

  const resetPage = () => setPage(1);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user ? hasMinRole(user.role, 'VENDOR_ADMIN') : false;

  const response = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const vans = (response?.data ?? []) as Array<{
    id: string;
    plateNumber: string;
    model?: string;
    capacity?: number;
    isActive?: boolean;
    defaultDriver?: { id: string; name: string };
    routes?: Array<{ id: string; name: string }>;
  }>;
  const total = response?.meta?.total ?? 0;

  const activeChips = [
    isActive ? { label: isActive === 'true' ? 'Active' : 'Inactive', clear: () => { resetPage(); setIsActive(null); } } : null,
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  const activeFilterCount = activeChips.length;

  const clearAll = () => {
    resetPage();
    setSearch(null);
    setIsActive(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 bg-card/30 p-3 sm:p-4 rounded-2xl border border-border">
        <div className="flex-1 w-full">
          <SearchInput placeholder="Search plate or model..." onBeforeChange={resetPage} />
        </div>
        <div className="hidden sm:block">
          <Select value={isActive || 'all'} onValueChange={(v) => { resetPage(); setIsActive(v === 'all' ? null : v); }}>
            <SelectTrigger className="w-[130px] rounded-xl bg-background/50 border-border h-10">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Vans</SelectItem>
              <SelectItem value="true">Active</SelectItem>
              <SelectItem value="false">Inactive</SelectItem>
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
          <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground font-semibold underline-offset-2 hover:underline">
            Clear all
          </button>
        </div>
      )}
      <DataTable
        data={vans}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No vans found"
        columns={[
          {
            key: 'plate', header: 'Plate Number',
            cell: (r) => (
              <div className={cn("flex items-center gap-2 whitespace-nowrap", !r.isActive && "opacity-60")}>
                <span className="font-bold text-sm text-white">{r.plateNumber}</span>
                {r.isActive === false && (
                  <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 text-muted-foreground border-muted-foreground/20 shrink-0">
                    OFF
                  </Badge>
                )}
              </div>
            )
          },
          { 
            key: 'model', header: 'Model', 
            cell: (r) => <span className="text-xs font-medium text-muted-foreground/80 truncate max-w-[120px] block">{r.model ?? '—'}</span> 
          },
          {
            key: 'driver',
            header: 'Default Driver',
            cell: (r) => r.defaultDriver
              ? <span className="text-xs font-semibold text-white/80 truncate max-w-[120px] block">{r.defaultDriver.name}</span>
              : <span className="text-xs text-muted-foreground/40">—</span>
          },
          {
            key: 'routes',
            header: 'Routes',
            cell: (r) => {
              const routes = r.routes ?? [];
              if (routes.length === 0) return <span className="text-xs text-muted-foreground/40">—</span>;
              
              const visible = routes.slice(0, 2);
              const remaining = routes.length - 2;

              return (
                <div className="flex items-center gap-1 whitespace-nowrap">
                  {visible.map((rt) => (
                    <Badge key={rt.id} variant="secondary" className="text-[9px] font-bold px-1.5 py-0 bg-white/5 text-white/60 rounded-md border-none">
                      {rt.name}
                    </Badge>
                  ))}
                  {remaining > 0 && (
                    <Badge variant="outline" className="text-[9px] font-bold px-1 py-0 border-white/10 text-muted-foreground/60 rounded-md">
                      +{remaining}
                    </Badge>
                  )}
                </div>
              );
            }
          },
          {
            key: 'status', header: 'Status',
            cell: (r) => (
              <div className="scale-90 origin-left">
                <Badge className={cn(
                  "text-[9px] font-bold px-2 py-0.5 rounded-md border-none uppercase tracking-wider",
                  r.isActive !== false ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-muted-foreground/40"
                )}>
                  {r.isActive !== false ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            )
          },
          {
            key: 'actions', header: '', width: '60px',
            cell: (r) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 p-1.5 rounded-xl">
                  <DropdownMenuItem onClick={() => onEdit(r as Record<string, unknown>)} className="rounded-lg cursor-pointer px-2 py-2">
                    <Pencil className="mr-2 h-4 w-4 text-orange-500" /> Edit
                  </DropdownMenuItem>
                  {isAdmin && <div className="h-[1px] bg-border/50 my-1" />}
                  {isAdmin && (r.isActive !== false ? (
                    <DropdownMenuItem
                      onClick={() => setDeactivateId(r.id)}
                      className="rounded-lg cursor-pointer px-2 py-2 text-orange-500 focus:text-orange-500 focus:bg-orange-500/10"
                    >
                      <PowerOff className="mr-2 h-4 w-4" /> Deactivate
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => reactivateVan(r.id)}
                      disabled={isReactivating}
                      className="rounded-lg cursor-pointer px-2 py-2 text-emerald-500 focus:text-emerald-500 focus:bg-emerald-500/10"
                    >
                      <Power className="mr-2 h-4 w-4" /> Reactivate
                    </DropdownMenuItem>
                  ))}
                  {isAdmin && (
                    <DropdownMenuItem
                      onClick={() => setDeleteId(r.id)}
                      className="rounded-lg cursor-pointer px-2 py-2 text-destructive focus:text-destructive focus:bg-destructive/10"
                    >
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
        title="Delete Van"
        description="Are you sure? This action cannot be undone."
        onConfirm={() => { if (deleteId) deleteVan(deleteId, { onSuccess: () => setDeleteId(null) }); }}
        isLoading={isDeleting}
        confirmLabel="Delete"
      />
      <ConfirmDialog
        open={!!deactivateId}
        onOpenChange={(o) => { if (!o) setDeactivateId(null); }}
        title="Deactivate Van"
        description="This van will be marked as inactive. You can reactivate it at any time."
        onConfirm={() => { if (deactivateId) deactivateVan(deactivateId, { onSuccess: () => setDeactivateId(null) }); }}
        isLoading={isDeactivating}
        confirmLabel="Deactivate"
      />
    </div>
  );
}
