'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger,
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { useRoutes, useDeleteRoute } from '../hooks/use-routes';

interface RouteListProps {
  onEdit: (route: Record<string, unknown>) => void;
}

export function RouteList({ onEdit }: RouteListProps) {
  const { data, isLoading } = useRoutes();
  const { mutate: deleteRoute, isPending: isDeleting } = useDeleteRoute();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const routes = (data ?? []) as Array<{ id: string; name: string; description?: string; driver?: { name: string }; van?: { plateNumber: string } }>;

  return (
    <div>
      <DataTable
        data={routes}
        isLoading={isLoading}
        emptyMessage="No routes found"
        columns={[
          { key: 'name', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'description', header: 'Description', cell: (r) => r.description ?? '—' },
          { key: 'driver', header: 'Driver', cell: (r) => r.driver?.name ?? '—' },
          { key: 'van', header: 'Van', cell: (r) => r.van?.plateNumber ?? '—' },
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
        title="Delete Route"
        description="Are you sure? This action cannot be undone."
        onConfirm={() => { if (deleteId) deleteRoute(deleteId, { onSuccess: () => setDeleteId(null) }); }}
        isLoading={isDeleting}
        confirmLabel="Delete"
      />
    </div>
  );
}
