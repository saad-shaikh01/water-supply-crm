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
import { Plus, Check, Edit2, Loader2, Tag } from 'lucide-react';
import {
  useCreateLabourType,
  useExtraLabourTypes,
  useUpdateLabourType,
} from '../hooks/use-extra-labour';
import { ExtraLabourTypeRecord } from '../api/extra-labour.api';

function Toggle({ enabled, onToggle, disabled, label }: { enabled: boolean; onToggle: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label || 'Toggle switch'}
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${enabled ? 'bg-emerald-500' : 'bg-input dark:bg-muted'}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

interface ManageLabourTypesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManageLabourTypesDialog({ open, onOpenChange }: ManageLabourTypesDialogProps) {
  const { data: types = [], isLoading } = useExtraLabourTypes(true);
  const createMutation = useCreateLabourType();
  const updateMutation = useUpdateLabourType();

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setErrorMsg(null);
    try {
      await createMutation.mutateAsync({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
      });
      setNewName('');
      setNewDesc('');
      setIsAdding(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setErrorMsg(msg || 'Failed to create labour type');
    }
  };

  const handleStartEdit = (t: ExtraLabourTypeRecord) => {
    setEditingId(t.id);
    setEditName(t.name);
    setEditDesc(t.description || '');
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim()) return;
    setErrorMsg(null);
    try {
      await updateMutation.mutateAsync({
        id,
        data: {
          name: editName.trim(),
          description: editDesc.trim() || null,
        },
      });
      setEditingId(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setErrorMsg(msg || 'Failed to update labour type');
    }
  };

  const handleToggleActive = async (t: ExtraLabourTypeRecord) => {
    setErrorMsg(null);
    try {
      await updateMutation.mutateAsync({
        id: t.id,
        data: { isActive: !t.isActive },
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setErrorMsg(msg || 'Failed to toggle status');
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
              <div className="space-y-2">
                <Label htmlFor="type-desc">Description (Optional)</Label>
                <Input
                  id="type-desc"
                  placeholder="Brief role notes..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
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
                    setNewDesc('');
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
                        <Input
                          size={32}
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          placeholder="Description"
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
                            {!t.isActive && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                Inactive
                              </Badge>
                            )}
                            {t.labourCount !== undefined && t.labourCount > 0 && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                                {t.labourCount} {t.labourCount === 1 ? 'person' : 'people'}
                              </Badge>
                            )}
                          </div>
                          {t.description && (
                            <p className="text-xs text-muted-foreground truncate">{t.description}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => handleStartEdit(t)}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <div className="flex items-center gap-1">
                            <Toggle
                              enabled={t.isActive}
                              onToggle={() => handleToggleActive(t)}
                              disabled={updateMutation.isPending}
                              label="Active Status"
                            />
                          </div>
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
