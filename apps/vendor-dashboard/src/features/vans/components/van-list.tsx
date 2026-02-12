'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { useVans, useDeleteVan } from '../hooks/use-vans';

interface VanListProps {
  onEdit: (van: Record<string, unknown>) => void;
}

export function VanList({ onEdit }: VanListProps) {
  const { data, isLoading } = useVans();
  const { mutate: deleteVan, isPending: isDeleting } = useDeleteVan();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const vans = (data ?? []) as Array<{ id: string; plateNumber: string; model?: string; capacity?: number }>;

  return (
    <div>
      <DataTable
        data={vans}
        isLoading={isLoading}
        emptyMessage="No vans found"
        columns={[
          { key: 'plate', header: 'Plate Number', cell: (r) => <span className="font-medium">{r.plateNumber}</span> },
          { key: 'model', header: 'Model', cell: (r) => r.model ?? '—' },
          { key: 'capacity', header: 'Capacity', cell: (r) => r.capacity ? `${r.capacity} units` : '—' },
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
                  <DropdownMenuItem onClick={() => setDeleteId(r.id)} className="text-destructive focus:text-destructive">
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
    </div>
  );
}
