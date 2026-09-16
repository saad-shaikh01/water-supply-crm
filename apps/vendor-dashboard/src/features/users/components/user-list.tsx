'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2, PowerOff, Power, X } from 'lucide-react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Label } from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useUsers, useDeleteUser, useDeactivateUser, useReactivateUser } from '../hooks/use-users';
import { cn } from '@water-supply-crm/ui';

interface UserListProps {
  onEdit: (user: Record<string, unknown>) => void;
}

export function UserList({ onEdit }: UserListProps) {
  const { data, isLoading, page, setPage, limit, setLimit, isActive, setIsActive } = useUsers();
  const { mutate: deleteUser, isPending: isDeleting } = useDeleteUser();
  const { mutate: deactivateUser, isPending: isDeactivating } = useDeactivateUser();
  const { mutate: reactivateUser, isPending: isReactivating } = useReactivateUser();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);

  const response = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const users = (response?.data ?? []) as Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    isActive?: boolean;
  }>;
  const total = response?.meta?.total ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</Label>
          <Select value={isActive} onValueChange={(v) => { setPage(1); setIsActive(v); }}>
            <SelectTrigger className="rounded-xl bg-background/50 border-border h-10 w-40">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border shadow-2xl">
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="true">Active</SelectItem>
              <SelectItem value="false">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isActive !== 'true' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setPage(1); setIsActive('true'); }}
            className="text-xs text-muted-foreground"
          >
            <X className="h-3.5 w-3.5 mr-1" /> Reset to Active
          </Button>
        )}
      </div>
      <DataTable
        data={users}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No users found"
        tableId="users-list"
        columns={[
          {
            key: 'name', header: 'Name',
            essential: true,
            cell: (r) => (
              <div className={cn("flex items-center gap-2", !r.isActive && "opacity-60")}>
                <span className="font-medium">{r.name}</span>
                {r.isActive === false && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground border-muted-foreground/30">
                    INACTIVE
                  </Badge>
                )}
              </div>
            )
          },
          { key: 'email', header: 'Email', defaultVisible: false, cell: (r) => r.email },
          { key: 'role', header: 'Role', cell: (r) => <StatusBadge status={r.role} /> },
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
            essential: true,
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
                      onClick={() => reactivateUser(r.id)}
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
        title="Delete User"
        description="Are you sure? This action cannot be undone."
        onConfirm={() => { if (deleteId) deleteUser(deleteId, { onSuccess: () => setDeleteId(null) }); }}
        isLoading={isDeleting}
        confirmLabel="Delete"
      />
      <ConfirmDialog
        open={!!deactivateId}
        onOpenChange={(o) => { if (!o) setDeactivateId(null); }}
        title="Deactivate User"
        description="This user won't be able to log in. You can reactivate them at any time."
        onConfirm={() => { if (deactivateId) deactivateUser(deactivateId, { onSuccess: () => setDeactivateId(null) }); }}
        isLoading={isDeactivating}
        confirmLabel="Deactivate"
      />
    </div>
  );
}
