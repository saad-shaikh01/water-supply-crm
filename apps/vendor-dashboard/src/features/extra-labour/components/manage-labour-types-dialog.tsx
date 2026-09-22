import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Badge,
} from '@water-supply-crm/ui';
import { Plus, Check, Edit2, Loader2, Tag, Trash2 } from 'lucide-react';
import {
  useCreateLabourType,
  useDeleteLabourType,
  useExtraLabourTypes,
  useUpdateLabourType,
} from '../hooks/use-extra-labour';
import { ExtraLabourTypeRecord } from '../api/extra-labour.api';

interface ManageLabourTypesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * A lightweight master list, same shape as Vehicle Maintenance Types: add /
 * rename / delete-if-unused. No description, no active/inactive concept — a
 * type is either in use (can't be deleted) or it isn't (can). The one
 * `isSystem` row ("Other") is the undeletable fallback and can only be
 * renamed.
 */
export function ManageLabourTypesDialog({ open, onOpenChange }: ManageLabourTypesDialogProps) {
  const { data: types = [], isLoading } = useExtraLabourTypes();
  const createMutation = useCreateLabourType();
  const updateMutation = useUpdateLabourType();
  const deleteMutation = useDeleteLabourType();

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setErrorMsg(null);
    try {
      await createMutation.mutateAsync({ name: newName.trim() });
      setNewName('');
      setIsAdding(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setErrorMsg(msg || 'Failed to create labour type');
    }
  };

  const handleStartEdit = (t: ExtraLabourTypeRecord) => {
    setEditingId(t.id);
    setEditName(t.name);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim()) return;
    setErrorMsg(null);
    try {
      await updateMutation.mutateAsync({ id, data: { name: editName.trim() } });
      setEditingId(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setErrorMsg(msg || 'Failed to update labour type');
    }
  };

  const handleDelete = async (t: ExtraLabourTypeRecord) => {
    setErrorMsg(null);
    setDeletingId(t.id);
    try {
      await deleteMutation.mutateAsync(t.id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setErrorMsg(msg || 'Failed to delete labour type');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-primary" />
            Manage Labourer Categories
          </DialogTitle>
          <DialogDescription>
            Configure job roles for extra labourers (e.g. Loader, Helper, Mechanic, Cleaner).
          </DialogDescription>
        </DialogHeader>

        {errorMsg && (
          <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">
            {errorMsg}
          </div>
        )}

        <div className="space-y-4 py-2">
          {!isAdding ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsAdding(true)}
              className="w-full justify-center gap-2 border-dashed"
            >
              <Plus className="w-4 h-4" /> Add New Category
            </Button>
          ) : (
            <div className="p-3 bg-muted/40 rounded-lg border space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                New Labour Category
              </h4>
              <div className="space-y-2">
                <Label htmlFor="type-name">Category Name *</Label>
                <Input
                  id="type-name"
                  placeholder="e.g. Electrician, Welder"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsAdding(false);
                    setNewName('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCreate}
                  disabled={!newName.trim() || createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : (
                    <Check className="w-4 h-4 mr-1" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          )}

          <div className="divide-y border rounded-lg overflow-hidden">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Loading categories...</div>
            ) : types.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">No categories defined</div>
            ) : (
              types.map((t) => {
                const isEditingThis = editingId === t.id;
                return (
                  <div key={t.id} className="p-3 flex items-center justify-between gap-3 bg-card hover:bg-muted/30">
                    {isEditingThis ? (
                      <div className="flex-1 space-y-2">
                        <Input
                          size={32}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Category name"
                        />
                        <div className="flex justify-end gap-2 pt-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleSaveEdit(t.id)}
                            disabled={updateMutation.isPending}
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-foreground">{t.name}</span>
                            {t.isSystem && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                Default
                              </Badge>
                            )}
                            {t.inUseCount > 0 && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                                {t.inUseCount} {t.inUseCount === 1 ? 'worker' : 'workers'}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => handleStartEdit(t)}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive disabled:opacity-40"
                            disabled={t.isSystem || t.inUseCount > 0 || deletingId === t.id}
                            title={
                              t.isSystem
                                ? 'The default fallback category cannot be deleted'
                                : t.inUseCount > 0
                                ? 'Still assigned to labourers — cannot be deleted'
                                : 'Delete category'
                            }
                            onClick={() => handleDelete(t)}
                          >
                            {deletingId === t.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
