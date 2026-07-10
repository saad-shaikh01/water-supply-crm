'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2, Copy, RotateCcw } from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Badge,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { Can } from '../../authz/components/can';
import { useRoles, useDeleteRole, useResetRole } from '../hooks/use-roles';
import type { RoleSummary } from '../api/roles.api';

interface RoleListProps {
  onEdit: (role: RoleSummary) => void;
  onClone: (role: RoleSummary) => void;
}

export function RoleList({ onEdit, onClone }: RoleListProps) {
  const { data, isLoading } = useRoles();
  const { mutate: deleteRole, isPending: isDeleting } = useDeleteRole();
  const { mutate: resetRole, isPending: isResetting } = useResetRole();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);

  const roles = data ?? [];

  return (
    <div>
      <DataTable
        data={roles}
        isLoading={isLoading}
        emptyMessage="No roles found"
        columns={[
          {
            key: 'name',
            header: 'Name',
            cell: (r) => (
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: r.color ?? '#71717a' }}
                />
                <span className="font-medium">{r.name}</span>
                <Badge variant={r.isSystem ? 'secondary' : 'outline'} className="text-[9px] px-1.5 py-0">
                  {r.isSystem ? 'SYSTEM' : 'CUSTOM'}
                </Badge>
              </div>
            ),
          },
          {
            key: 'description',
            header: 'Description',
            cell: (r) => (
              <span className={cn('text-muted-foreground', !r.description && 'italic')}>
                {r.description || 'No description'}
              </span>
            ),
          },
          { key: 'userCount', header: 'Members', cell: (r) => r.userCount },
          { key: 'permissionCount', header: 'Permissions', cell: (r) => r.permissionCount },
          {
            key: 'actions',
            header: '',
            width: '60px',
            cell: (r) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 p-1.5 rounded-xl">
                  <Can permission="roles:update">
                    <DropdownMenuItem onClick={() => onEdit(r)} className="rounded-lg cursor-pointer px-2 py-2">
                      <Pencil className="mr-2 h-4 w-4 text-orange-500" /> Edit
                    </DropdownMenuItem>
                  </Can>
                  <Can permission="roles:clone">
                    <DropdownMenuItem onClick={() => onClone(r)} className="rounded-lg cursor-pointer px-2 py-2">
                      <Copy className="mr-2 h-4 w-4 text-sky-500" /> Clone
                    </DropdownMenuItem>
                  </Can>
                  {r.isSystem && (
                    <Can permission="roles:reset">
                      <DropdownMenuItem
                        onClick={() => setResetId(r.id)}
                        className="rounded-lg cursor-pointer px-2 py-2"
                      >
                        <RotateCcw className="mr-2 h-4 w-4 text-amber-500" /> Reset to preset
                      </DropdownMenuItem>
                    </Can>
                  )}
                  <div className="h-[1px] bg-border/50 my-1" />
                  <Can permission="roles:delete">
                    <DropdownMenuItem
                      onClick={() => setDeleteId(r.id)}
                      disabled={r.isSystem || r.userCount > 0}
                      className="rounded-lg cursor-pointer px-2 py-2 text-destructive focus:text-destructive focus:bg-destructive/10"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </Can>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="Delete Role"
        description="Are you sure? This action cannot be undone."
        onConfirm={() => { if (deleteId) deleteRole(deleteId, { onSuccess: () => setDeleteId(null) }); }}
        isLoading={isDeleting}
        confirmLabel="Delete"
      />
      <ConfirmDialog
        open={!!resetId}
        onOpenChange={(o) => { if (!o) setResetId(null); }}
        title="Reset to Preset"
        description="This replaces the role's current permissions with its original preset. Any customizations will be lost."
        onConfirm={() => { if (resetId) resetRole(resetId, { onSuccess: () => setResetId(null) }); }}
        isLoading={isResetting}
        confirmLabel="Reset"
        variant="destructive"
      />
    </div>
  );
}
