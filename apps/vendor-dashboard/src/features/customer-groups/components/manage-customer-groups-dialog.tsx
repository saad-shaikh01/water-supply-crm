'use client';

import { useState } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Skeleton,
} from '@water-supply-crm/ui';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import {
  useCreateCustomerGroup,
  useCustomerGroups,
  useDeleteCustomerGroup,
  useRenameCustomerGroup,
} from '../hooks/use-customer-groups';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

type Target = { id: string; name: string; customerCount: number };

/**
 * Group / Sub-group catalogue. A group that still has customers cannot be deleted (the server
 * enforces it; the button is also disabled). Deleting an empty one voids it so history that
 * referenced it stays filterable.
 */
export function ManageCustomerGroupsDialog({ open, onOpenChange, canCreate, canUpdate, canDelete }: Props) {
  const { data: groups, isLoading } = useCustomerGroups(open);
  const { mutate: create, isPending: isCreating } = useCreateCustomerGroup();
  const { mutate: rename, isPending: isRenaming } = useRenameCustomerGroup();
  const { mutate: remove, isPending: isDeleting } = useDeleteCustomerGroup();

  const [newGroup, setNewGroup] = useState('');
  // Which group is currently adding a sub-group, and the draft name.
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [newSub, setNewSub] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Target | null>(null);

  const submitGroup = () => {
    const name = newGroup.trim();
    if (!name) return;
    create({ name }, { onSuccess: () => setNewGroup('') });
  };

  const submitSub = (parentId: string) => {
    const name = newSub.trim();
    if (!name) return;
    create({ name, parentId }, { onSuccess: () => { setNewSub(''); setAddingSubFor(null); } });
  };

  const submitRename = () => {
    if (!editing || !editing.name.trim()) return;
    rename({ id: editing.id, name: editing.name.trim() }, { onSuccess: () => setEditing(null) });
  };

  const renderName = (id: string, name: string) =>
    editing?.id === id ? (
      <div className="flex items-center gap-1 flex-1">
        <Input
          autoFocus
          value={editing.name}
          onChange={(e) => setEditing({ id, name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setEditing(null); }}
          className="h-8 text-sm"
        />
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={submitRename} disabled={isRenaming}>
          <Check className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditing(null)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    ) : (
      <span className="flex-1 text-sm font-medium truncate">{name}</span>
    );

  const rowActions = (t: Target) => (
    <div className="flex items-center gap-1 shrink-0">
      <Badge variant="secondary" className="text-[10px]">{t.customerCount} customer{t.customerCount === 1 ? '' : 's'}</Badge>
      {canUpdate && editing?.id !== t.id && (
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditing({ id: t.id, name: t.name })}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {canDelete && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-destructive disabled:opacity-40"
          disabled={t.customerCount > 0}
          title={t.customerCount > 0 ? 'Reassign its customers before deleting' : 'Delete'}
          onClick={() => setDeleteTarget(t)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Customer Groups</DialogTitle>
            <DialogDescription>
              A group can optionally have sub-groups. Groups with customers assigned cannot be deleted.
            </DialogDescription>
          </DialogHeader>

          {canCreate && (
            <div className="flex gap-2">
              <Input
                placeholder="New group name (e.g. Arsalan Traders)"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitGroup(); }}
              />
              <Button onClick={submitGroup} disabled={!newGroup.trim() || isCreating} className="shrink-0 gap-1">
                {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
              </Button>
            </div>
          )}

          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !groups?.length ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No groups yet.</p>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g.id} className="rounded-xl border border-border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {renderName(g.id, g.name)}
                    {rowActions(g)}
                  </div>

                  {g.subGroups.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 pl-5 border-l-2 border-border ml-1">
                      {renderName(s.id, s.name)}
                      {rowActions(s)}
                    </div>
                  ))}

                  {canCreate && (
                    addingSubFor === g.id ? (
                      <div className="flex gap-2 pl-5 ml-1">
                        <Input
                          autoFocus
                          placeholder="Sub-group name"
                          value={newSub}
                          onChange={(e) => setNewSub(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') submitSub(g.id); if (e.key === 'Escape') setAddingSubFor(null); }}
                          className="h-8 text-sm"
                        />
                        <Button size="sm" className="h-8" onClick={() => submitSub(g.id)} disabled={!newSub.trim() || isCreating}>Add</Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setAddingSubFor(null); setNewSub(''); }}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setAddingSubFor(g.id); setNewSub(''); }}
                        className="pl-5 ml-1 text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                      >
                        <Plus className="h-3 w-3" /> Add sub-group
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title={`Delete "${deleteTarget?.name ?? ''}"?`}
        description="It will no longer appear in pickers. Past records that referenced it stay filterable."
        isLoading={isDeleting}
        confirmLabel="Delete"
        onConfirm={() => deleteTarget && remove(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </>
  );
}
