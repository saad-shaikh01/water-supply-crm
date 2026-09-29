'use client';

import { useState } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  Badge, Button, Input, Label, Skeleton,
} from '@water-supply-crm/ui';
import type { VehicleServiceTypeEntry } from '@water-supply-crm/types';
import { ConfirmDialog } from '../../../../components/shared/confirm-dialog';
import {
  useCreateServiceType, useDeleteServiceType, useRenameServiceType, useServiceTypes,
} from '../../hooks/use-maintenance';

interface ManageServiceTypesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after a type is created — the Record Service form selects it. */
  onCreated?: (type: VehicleServiceTypeEntry) => void;
  /** Fired after a type is removed — the form clears it if it was selected. */
  onDeleted?: (type: VehicleServiceTypeEntry) => void;
}

const toPositiveInt = (raw: string): number | undefined => {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function intervalSummary(t: VehicleServiceTypeEntry): string | null {
  const parts = [
    t.defaultIntervalKm ? `every ${t.defaultIntervalKm.toLocaleString()} km` : null,
    t.defaultIntervalDays ? `every ${t.defaultIntervalDays} days` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Add / remove the vendor's service types (the Record Service dropdown).
 * A type can only be removed while no service record uses it — the row's
 * delete button is disabled otherwise (the server enforces the same rule).
 */
export function ManageServiceTypesDialog({ open, onOpenChange, onCreated, onDeleted }: ManageServiceTypesDialogProps) {
  const { data: types, isLoading } = useServiceTypes();
  const { mutate: createType, isPending: isCreating } = useCreateServiceType();
  const { mutate: deleteType, isPending: isDeleting } = useDeleteServiceType();
  const { mutate: renameType, isPending: isRenaming } = useRenameServiceType();

  // Inline edit: which row is being edited + its draft name/interval.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editKm, setEditKm] = useState('');
  const [editDays, setEditDays] = useState('');

  const [label, setLabel] = useState('');
  const [intervalKm, setIntervalKm] = useState('');
  const [intervalDays, setIntervalDays] = useState('');
  const [pendingDelete, setPendingDelete] = useState<VehicleServiceTypeEntry | null>(null);

  const trimmed = label.trim();

  function handleAdd(e: React.FormEvent) {
    // Nested inside the Record Service <form> in the DOM tree of React events —
    // stop the submit from bubbling into (and submitting) the outer form.
    e.preventDefault();
    e.stopPropagation();
    if (trimmed.length < 2) return;
    createType(
      {
        label: trimmed,
        defaultIntervalKm: toPositiveInt(intervalKm),
        defaultIntervalDays: toPositiveInt(intervalDays),
      },
      {
        onSuccess: (created) => {
          setLabel('');
          setIntervalKm('');
          setIntervalDays('');
          onCreated?.(created);
        },
      },
    );
  }

  function startEdit(t: VehicleServiceTypeEntry) {
    setEditingId(t.id);
    setEditLabel(t.label);
    setEditKm(t.defaultIntervalKm ? String(t.defaultIntervalKm) : '');
    setEditDays(t.defaultIntervalDays ? String(t.defaultIntervalDays) : '');
  }

  function saveEdit(t: VehicleServiceTypeEntry) {
    const next = editLabel.trim();
    if (next.length < 2) return;
    const nextKm = toPositiveInt(editKm) ?? null;
    const nextDays = toPositiveInt(editDays) ?? null;
    if (next === t.label && nextKm === t.defaultIntervalKm && nextDays === t.defaultIntervalDays) {
      setEditingId(null);
      return;
    }
    renameType(
      { id: t.id, label: next, defaultIntervalKm: nextKm, defaultIntervalDays: nextDays },
      { onSuccess: () => setEditingId(null) },
    );
  }

  function handleConfirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteType(target.id, {
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
            <DialogTitle className="text-xl font-black">Service Types</DialogTitle>
            <DialogDescription>
              Add a type that isn&apos;t in the list, rename one, or remove one you never use. Renaming also updates
              past records. A type that already has service records can&apos;t be removed.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAdd} className="space-y-3 rounded-2xl border p-3">
            <div className="space-y-2">
              <Label htmlFor="new-service-type">New service type</Label>
              <Input
                id="new-service-type"
                className="rounded-xl"
                placeholder="e.g. Clutch Plate, Wiper Blades"
                maxLength={60}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="new-service-km" className="text-xs text-muted-foreground">Remind every (km) — optional</Label>
                <Input
                  id="new-service-km"
                  type="number"
                  min={1}
                  className="rounded-xl"
                  value={intervalKm}
                  onChange={(e) => setIntervalKm(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-service-days" className="text-xs text-muted-foreground">Remind every (days) — optional</Label>
                <Input
                  id="new-service-days"
                  type="number"
                  min={1}
                  className="rounded-xl"
                  value={intervalDays}
                  onChange={(e) => setIntervalDays(e.target.value)}
                />
              </div>
            </div>
            <Button type="submit" disabled={isCreating || trimmed.length < 2} className="w-full rounded-xl font-bold gap-2">
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add service type
            </Button>
          </form>

          <div className="space-y-1.5">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 rounded-xl" />)
              : (types ?? []).map((t) => {
                  const blockedReason = t.isSystem
                    ? 'System type — cannot be removed'
                    : t.usageCount > 0
                      ? `Used in ${t.usageCount} service record${t.usageCount === 1 ? '' : 's'} — cannot be removed`
                      : null;
                  const summary = intervalSummary(t);

                  if (editingId === t.id) {
                    return (
                      <div key={t.id} className="space-y-2 rounded-xl border border-primary/40 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Input
                            autoFocus
                            aria-label={`Rename ${t.label}`}
                            className="h-8 rounded-lg"
                            maxLength={60}
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            onKeyDown={(e) => {
                              // Enter saves / Escape cancels — without closing the dialog.
                              if (e.key === 'Enter') { e.preventDefault(); saveEdit(t); }
                              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingId(null); }
                            }}
                          />
                          <Button
                            type="button"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            disabled={isRenaming || editLabel.trim().length < 2}
                            aria-label="Save"
                            onClick={() => saveEdit(t)}
                          >
                            {isRenaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            disabled={isRenaming}
                            aria-label="Cancel edit"
                            onClick={() => setEditingId(null)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 pl-0.5">
                          <div className="space-y-1">
                            <Label htmlFor={`edit-km-${t.id}`} className="text-xs text-muted-foreground">
                              Remind every (km) — optional
                            </Label>
                            <Input
                              id={`edit-km-${t.id}`}
                              type="number"
                              min={1}
                              className="h-8 rounded-lg"
                              value={editKm}
                              onChange={(e) => setEditKm(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`edit-days-${t.id}`} className="text-xs text-muted-foreground">
                              Remind every (days) — optional
                            </Label>
                            <Input
                              id={`edit-days-${t.id}`}
                              type="number"
                              min={1}
                              className="h-8 rounded-lg"
                              value={editDays}
                              onChange={(e) => setEditDays(e.target.value)}
                            />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground pl-0.5">
                          Only applies to vehicles that haven&apos;t used this type yet — already-tracked vehicles keep
                          their current interval (editable from that vehicle&apos;s Maintenance tab).
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{t.label}</p>
                        {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {t.usageCount > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {t.usageCount} record{t.usageCount === 1 ? '' : 's'}
                          </Badge>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={`Rename ${t.label}`}
                          aria-label={`Rename ${t.label}`}
                          onClick={() => startEdit(t)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          disabled={!!blockedReason}
                          title={blockedReason ?? `Remove ${t.label}`}
                          aria-label={blockedReason ?? `Remove ${t.label}`}
                          onClick={() => setPendingDelete(t)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title="Remove service type?"
        description={`"${pendingDelete?.label ?? ''}" will be removed from the list and from every vehicle's maintenance schedule. It has no service records, so no history is lost.`}
        confirmLabel="Remove"
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />
    </>
  );
}
