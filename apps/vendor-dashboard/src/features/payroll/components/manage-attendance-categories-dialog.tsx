'use client';

import { useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  Badge, Button, Input, Label, Skeleton,
} from '@water-supply-crm/ui';
import type { AttendanceCategory } from '@water-supply-crm/types';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { useAttendanceCategories, useCreateAttendanceCategory, useDeleteAttendanceCategory } from '../hooks/use-attendance';

interface ManageAttendanceCategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after a category is created — the Mark Attendance dialog selects it. */
  onCreated?: (category: AttendanceCategory) => void;
  /** Fired after a category is removed — the form clears it if it was selected. */
  onDeleted?: (category: AttendanceCategory) => void;
}

/**
 * Add / remove the vendor's manual-PRESENT reason categories (the "why was
 * this present" field). A category can only be removed while no attendance
 * row uses it — the row's delete button is disabled otherwise (the server
 * enforces the same rule). No rename — not asked for; add another if a name
 * needs correcting.
 */
export function ManageAttendanceCategoriesDialog({
  open,
  onOpenChange,
  onCreated,
  onDeleted,
}: ManageAttendanceCategoriesDialogProps) {
  const { data: categories, isLoading } = useAttendanceCategories(open);
  const { mutate: createCategory, isPending: isCreating } = useCreateAttendanceCategory();
  const { mutate: deleteCategory, isPending: isDeleting } = useDeleteAttendanceCategory();

  const [name, setName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AttendanceCategory | null>(null);

  const trimmed = name.trim();

  function handleAdd(e: React.FormEvent) {
    // Nested inside the Mark Attendance <form>-less dialog, but keep the same
    // defensive stop as the fleet equivalent in case this ever moves inline.
    e.preventDefault();
    e.stopPropagation();
    if (trimmed.length < 2) return;
    createCategory(
      { name: trimmed },
      {
        onSuccess: (created) => {
          setName('');
          onCreated?.(created);
        },
      },
    );
  }

  function handleConfirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteCategory(target.id, {
      onSuccess: () => {
        onDeleted?.(target);
        setPendingDelete(null);
      },
      onError: () => setPendingDelete(null),
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="rounded-3xl max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Attendance Categories</DialogTitle>
            <DialogDescription>
              Add a reason for a manual Present marking — e.g. an employee who wasn&apos;t on their route but was
              doing some other office task. A category already used on an attendance record can&apos;t be removed.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAdd} className="space-y-3 rounded-2xl border p-3">
            <div className="space-y-2">
              <Label htmlFor="new-attendance-category">New category</Label>
              <Input
                id="new-attendance-category"
                className="rounded-xl"
                placeholder="e.g. Office — other business"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={isCreating || trimmed.length < 2} className="w-full rounded-xl font-bold gap-2">
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add category
            </Button>
          </form>

          <div className="space-y-1.5">
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-11 rounded-xl" />)
              : (categories ?? []).map((c) => {
                  const blockedReason =
                    c.usageCount > 0
                      ? `Used on ${c.usageCount} attendance record${c.usageCount === 1 ? '' : 's'} — cannot be removed`
                      : null;
                  return (
                    <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
                      <p className="text-sm font-semibold truncate min-w-0">{c.name}</p>
                      <div className="flex items-center gap-2 shrink-0">
                        {c.usageCount > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {c.usageCount} record{c.usageCount === 1 ? '' : 's'}
                          </Badge>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          disabled={!!blockedReason}
                          title={blockedReason ?? `Remove ${c.name}`}
                          aria-label={blockedReason ?? `Remove ${c.name}`}
                          onClick={() => setPendingDelete(c)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
        description={`"${pendingDelete?.name ?? ''}" will be removed from the list. It has no attendance records, so no history is lost.`}
        confirmLabel="Remove"
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />
    </>
  );
}
