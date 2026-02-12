'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useUsers, useDeleteUser } from '../hooks/use-users';

interface UserListProps {
  onEdit: (user: Record<string, unknown>) => void;
}

export function UserList({ onEdit }: UserListProps) {
  const { data, isLoading } = useUsers();
  const { mutate: deleteUser, isPending: isDeleting } = useDeleteUser();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const users = (data ?? []) as Array<{ id: string; name: string; email: string; role: string }>;

  return (
    <div>
      <DataTable
        data={users}
        isLoading={isLoading}
        emptyMessage="No users found"
        columns={[
          { key: 'name', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'email', header: 'Email', cell: (r) => r.email },
          { key: 'role', header: 'Role', cell: (r) => <StatusBadge status={r.role} /> },
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
        title="Delete User"
        description="Are you sure? This action cannot be undone."
        onConfirm={() => { if (deleteId) deleteUser(deleteId, { onSuccess: () => setDeleteId(null) }); }}
        isLoading={isDeleting}
        confirmLabel="Delete"
      />
    </div>
  );
}
