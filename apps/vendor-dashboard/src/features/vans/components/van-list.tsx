'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2, PowerOff, Power } from 'lucide-react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Badge } from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { useVans, useDeleteVan, useDeactivateVan, useReactivateVan } from '../hooks/use-vans';
import { cn } from '@water-supply-crm/ui';

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

  const response = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const vans = (response?.data ?? []) as Array<{
    id: string;
    plateNumber: string;
    model?: string;
    capacity?: number;
    isActive?: boolean;
    routes?: Array<{ name: string }>;
  }>;
  const total = response?.meta?.total ?? 0;

  return (
    <div>
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
              <div className={cn("flex items-center gap-2", !r.isActive && "opacity-60")}>
                <span className="font-medium">{r.plateNumber}</span>
                {r.isActive === false && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground border-muted-foreground/30">
                    INACTIVE
                  </Badge>
                )}
              </div>
            )
          },
          { key: 'model', header: 'Model', cell: (r) => r.model ?? '—' },
          { key: 'capacity', header: 'Capacity', cell: (r) => r.capacity ? `${r.capacity} units` : '—' },
          {
            key: 'status', header: 'Status',
            cell: (r) => (
              <Badge className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full border-none",
                r.isActive !== false ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
              )}>
                {r.isActive !== false ? 'Active' : 'Inactive'}
              </Badge>
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
                  <div className="h-[1px] bg-border/50 my-1" />
                  {r.isActive !== false ? (
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
                  )}
                  <DropdownMenuItem
                    onClick={() => setDeleteId(r.id)}
                    className="rounded-lg cursor-pointer px-2 py-2 text-destructive focus:text-destructive focus:bg-destructive/10"
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
