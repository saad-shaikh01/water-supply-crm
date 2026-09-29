'use client';

import { useState } from 'react';
import { Loader2, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  Badge, Button, Input, Label, Skeleton, Textarea,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import type { CustomerFlagCategory } from '@water-supply-crm/types';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import {
  useCustomerFlagCategories,
  useCreateCustomerFlagCategory,
  useUpdateCustomerFlagCategory,
  useDeleteCustomerFlagCategory,
} from '../hooks/use-customer-flags';

const DEFAULT_COLOR = '#ef4444';

interface ManageCustomerFlagCategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Admin-managed catalogue behind Customer Flags (owner-requested 2026-09-29).
 * No built-ins — same convention as `AttendanceCategory` — a vendor adds its
 * own categories here (e.g. a red "To Be Closed", an amber "Payment
 * Overdue"). A category still attached to any flag (open or resolved) can't
 * be deleted; deactivate it instead so history stays intact.
 */
export function ManageCustomerFlagCategoriesDialog({ open, onOpenChange }: ManageCustomerFlagCategoriesDialogProps) {
  const { data: categories, isLoading } = useCustomerFlagCategories(open);
  const { mutate: createCategory, isPending: isCreating } = useCreateCustomerFlagCategory();
  const { mutate: updateCategory, isPending: isUpdating } = useUpdateCustomerFlagCategory();
  const { mutate: deleteCategory, isPending: isDeleting } = useDeleteCustomerFlagCategory();

  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [defaultMessage, setDefaultMessage] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; color: string; defaultMessage: string }>({
    name: '',
    color: DEFAULT_COLOR,
    defaultMessage: '',
  });
  const [pendingDelete, setPendingDelete] = useState<CustomerFlagCategory | null>(null);

  const trimmed = name.trim();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (trimmed.length < 2) return;
    createCategory(
      { name: trimmed, color, defaultMessage: defaultMessage.trim() || undefined },
      {
        onSuccess: () => {
          setName('');
          setColor(DEFAULT_COLOR);
          setDefaultMessage('');
        },
      },
    );
  }

  function startEdit(c: CustomerFlagCategory) {
    setEditingId(c.id);
    setEditDraft({ name: c.name, color: c.color, defaultMessage: c.defaultMessage ?? '' });
  }

  function saveEdit(c: CustomerFlagCategory) {
    updateCategory(
      {
        id: c.id,
        data: {
          name: editDraft.name.trim(),
          color: editDraft.color,
          defaultMessage: editDraft.defaultMessage.trim(),
        },
      },
      { onSuccess: () => setEditingId(null) },
    );
  }

  function handleConfirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteCategory(target.id, { onSettled: () => setPendingDelete(null) });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Customer Flag Categories</DialogTitle>
            <DialogDescription>
              Define the highlights staff can put on a customer — a color and a default reason shown wherever that
              customer appears. A category still used on any flag (open or resolved) can&apos;t be deleted; toggle it
              off instead.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAdd} className="space-y-3 rounded-2xl border p-3">
            <div className="flex gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="new-flag-category-name">New category</Label>
                <Input
                  id="new-flag-category-name"
                  className="rounded-xl"
                  placeholder="e.g. To Be Closed"
                  maxLength={60}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-flag-category-color">Color</Label>
                <Input
                  id="new-flag-category-color"
                  type="color"
                  className="h-10 w-14 p-1 rounded-xl"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-flag-category-message">Default message (optional)</Label>
              <Textarea
                id="new-flag-category-message"
                className="rounded-xl"
                placeholder="Pre-filled reason when staff flag a customer with this category"
                maxLength={500}
                rows={2}
                value={defaultMessage}
                onChange={(e) => setDefaultMessage(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={isCreating || trimmed.length < 2} className="w-full rounded-xl font-bold gap-2">
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add category
            </Button>
          </form>

          <div className="space-y-1.5">
            {isLoading
              ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)
              : (categories ?? []).map((c) => {
                  const isEditing = editingId === c.id;
                  return (
                    <div key={c.id} className="rounded-xl border px-3 py-2 space-y-2">
                      {isEditing ? (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <Input
                              className="rounded-lg flex-1"
                              value={editDraft.name}
                              onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                            />
                            <Input
                              type="color"
                              className="h-9 w-12 p-1 rounded-lg"
                              value={editDraft.color}
                              onChange={(e) => setEditDraft((d) => ({ ...d, color: e.target.value }))}
                            />
                          </div>
                          <Textarea
                            className="rounded-lg"
                            rows={2}
                            value={editDraft.defaultMessage}
                            onChange={(e) => setEditDraft((d) => ({ ...d, defaultMessage: e.target.value }))}
                          />
                          <div className="flex justify-end gap-2">
                            <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                            <Button type="button" size="sm" disabled={isUpdating} onClick={() => saveEdit(c)}>
                              {isUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                                {c.name}
                                {!c.isActive && (
                                  <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5">
                                    inactive
                                  </Badge>
                                )}
                              </p>
                              {c.defaultMessage && (
                                <p className="text-xs text-muted-foreground truncate">{c.defaultMessage}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {(c.activeFlagCount ?? 0) > 0 && (
                              <Badge variant="outline" className="text-xs">
                                {c.activeFlagCount} active
                              </Badge>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className={cn('h-7 rounded-full text-[10px] font-bold px-2', c.isActive ? 'text-emerald-500 border-emerald-500/30' : 'text-muted-foreground')}
                              onClick={() => updateCategory({ id: c.id, data: { isActive: !c.isActive } })}
                              aria-label={c.isActive ? 'Deactivate category' : 'Activate category'}
                            >
                              {c.isActive ? 'Active' : 'Inactive'}
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(c)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              title={`Remove ${c.name}`}
                              aria-label={`Remove ${c.name}`}
                              onClick={() => setPendingDelete(c)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            {!isLoading && categories?.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">No categories yet — add one above.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title="Remove category?"
        description={`"${pendingDelete?.name ?? ''}" will be removed from the list. If it's ever been used on a flag, removal will be blocked — deactivate it instead.`}
        confirmLabel="Remove"
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />
    </>
  );
}
