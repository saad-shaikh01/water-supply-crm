'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, ShieldAlert } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Badge, Skeleton,
} from '@water-supply-crm/ui';
import { expandPattern, resolveEffectivePermissions, type Permission } from '@water-supply-crm/authz';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { PermissionMatrix } from '../../roles/components/permission-matrix';
import { usePermissionCatalog } from '../../roles/hooks/use-permission-catalog';
import { useRole } from '../../roles/hooks/use-roles';
import { useUserAccess, useSetOverrides } from '../hooks/use-user-access';

interface UserOverridesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  userName?: string;
}

type Effect = 'ALLOW' | 'DENY';
interface OverrideEntry {
  effect: Effect;
  expiresAt: string | null;
}
type OverridesMap = Map<Permission, OverrideEntry>;

function overridesEqual(a: OverridesMap, b: OverridesMap): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (!other || other.effect !== value.effect || other.expiresAt !== value.expiresAt) return false;
  }
  return true;
}

/**
 * Per-user permission override manager. Reuses `PermissionMatrix` (D6) as a single editable
 * view of the user's *effective* permissions (role ∪ ALLOW overrides, minus DENY overrides) —
 * checked state always matches what the user can currently do, so there's no separate
 * "Effective Permissions" tab to cross-reference before deciding what to change. Toggling a
 * box is diffed against the role's own baseline (fetched separately via `useRole`) to decide
 * which override it implies: checking something the role doesn't grant writes an ALLOW
 * override; unchecking something the role does grant writes a DENY override; toggling back to
 * the baseline value removes the override entirely rather than leaving a redundant row. Saves
 * as a full replacement via `PATCH /users/:id/overrides`, matching how the Role Editor always
 * sends a complete permission array rather than incremental add/remove calls.
 */
export function UserOverridesDialog({ open, onOpenChange, userId, userName }: UserOverridesDialogProps) {
  const { data: userAccess, isLoading: isLoadingAccess, isError } = useUserAccess(open ? userId : null);
  const { data: roleDetail, isLoading: isLoadingRole } = useRole(open ? userAccess?.role?.id ?? null : null);
  const { data: catalogGroups } = usePermissionCatalog();
  const { mutate: saveOverrides, isPending: isSaving } = useSetOverrides();

  // Waiting on the role's own baseline too — without it a toggle right after opening the
  // dialog can't tell an ALLOW-worthy addition from a "just remove the DENY override" one.
  const isLoading = isLoadingAccess || (!!userAccess?.role?.id && isLoadingRole);

  const [overridesMap, setOverridesMap] = useState<OverridesMap>(new Map());
  const [initialMap, setInitialMap] = useState<OverridesMap>(new Map());
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  useEffect(() => {
    if (!open || !userAccess) return;
    const map: OverridesMap = new Map();
    for (const override of userAccess.overrides) {
      for (const permission of expandPattern(override.permission)) {
        map.set(permission, { effect: override.effect, expiresAt: override.expiresAt });
      }
    }
    setOverridesMap(map);
    setInitialMap(new Map(map));
  }, [open, userAccess]);

  const hasUnsavedChanges = !overridesEqual(overridesMap, initialMap);

  useEffect(() => {
    if (!open || !hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [open, hasUnsavedChanges]);

  // Metadata lookup (display label + catalog order) shared by the active-overrides list —
  // reuses the same catalog the matrices already fetch, never a second permission list.
  const permissionMeta = useMemo(() => {
    const map = new Map<Permission, { label: string; groupLabel: string; order: number }>();
    let order = 0;
    for (const group of catalogGroups ?? []) {
      for (const perm of group.permissions) {
        map.set(perm.key as Permission, { label: perm.label, groupLabel: group.label, order: order++ });
      }
    }
    return map;
  }, [catalogGroups]);

  // Live effective set — recomputed from the role's raw grants plus the *in-progress*
  // `overridesMap` via the same canonical resolver the backend uses (imported, not
  // reimplemented), so the matrix reflects each toggle immediately instead of the frozen
  // server snapshot, and expiry dates are honored exactly as they will be on save.
  const effectiveSet = useMemo(
    () =>
      new Set(
        resolveEffectivePermissions({
          rolePermissions: roleDetail?.permissions ?? [],
          overrides: [...overridesMap.entries()].map(([permission, entry]) => ({
            permission,
            effect: entry.effect,
            expiresAt: entry.expiresAt,
          })),
        }),
      ),
    [roleDetail, overridesMap],
  );

  // The role's own grants, untouched by this user's overrides — the baseline a toggle is
  // diffed against to decide whether it implies an ALLOW override, a DENY override, or just
  // removes one that's now redundant.
  const baselineSet = useMemo(() => {
    const set = new Set<Permission>();
    for (const pattern of roleDetail?.permissions ?? []) {
      for (const permission of expandPattern(pattern)) set.add(permission);
    }
    return set;
  }, [roleDetail]);

  const activeOverrides = useMemo(
    () =>
      [...overridesMap.entries()].sort(
        ([a], [b]) => (permissionMeta.get(a)?.order ?? 0) - (permissionMeta.get(b)?.order ?? 0),
      ),
    [overridesMap, permissionMeta],
  );

  /** Diffs the matrix's full "next selected" (= next effective) set against both the current
   * effective set and the role baseline, and writes exactly the override each changed
   * permission implies: newly checked + role doesn't grant it → ALLOW; newly unchecked + role
   * does grant it → DENY; toggled back to what the role already says → override removed. */
  const handleEffectiveChange = (next: Set<Permission>) => {
    setOverridesMap((prev) => {
      const nextMap = new Map(prev);
      for (const permission of next) {
        if (effectiveSet.has(permission)) continue; // unchanged
        if (baselineSet.has(permission)) nextMap.delete(permission); // was DENY-overridden; restore
        else nextMap.set(permission, { effect: 'ALLOW', expiresAt: prev.get(permission)?.expiresAt ?? null });
      }
      for (const permission of effectiveSet) {
        if (next.has(permission)) continue; // unchanged
        if (baselineSet.has(permission)) nextMap.set(permission, { effect: 'DENY', expiresAt: prev.get(permission)?.expiresAt ?? null });
        else nextMap.delete(permission); // was ALLOW-overridden; revoke
      }
      return nextMap;
    });
  };

  const setExpiry = (permission: Permission, value: string) => {
    setOverridesMap((prev) => {
      const existing = prev.get(permission);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(permission, { ...existing, expiresAt: value || null });
      return next;
    });
  };

  const removeOverride = (permission: Permission) => {
    setOverridesMap((prev) => {
      const next = new Map(prev);
      next.delete(permission);
      return next;
    });
  };

  const requestClose = () => {
    if (hasUnsavedChanges) setConfirmCloseOpen(true);
    else onOpenChange(false);
  };

  const onSave = () => {
    if (!userId) return;
    const overrides = activeOverrides.map(([permission, entry]) => ({
      permission,
      effect: entry.effect,
      ...(entry.expiresAt ? { expiresAt: entry.expiresAt } : {}),
    }));
    saveOverrides({ userId, overrides }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) requestClose(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Permission Overrides{userName ? ` — ${userName}` : ''}</DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive py-2">Failed to load this user&apos;s permission overrides.</p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Base role: <span className="font-medium text-foreground">{userAccess?.role?.name ?? 'No role assigned'}</span>
              </p>

              <div>
                <p className="text-xs text-muted-foreground pb-2">
                  Checked = what this user can do right now (role plus any active overrides).
                  Check a box to grant it, uncheck one to block it — each change is saved below
                  as the ALLOW or DENY override it implies.
                </p>
                <PermissionMatrix
                  selected={effectiveSet}
                  onChange={handleEffectiveChange}
                  disabled={isSaving}
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Active Overrides</span>
                  <span className="text-xs text-muted-foreground">{activeOverrides.length}</span>
                </div>

                {activeOverrides.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No overrides configured. This user&apos;s access comes entirely from their role.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {activeOverrides.map(([permission, entry]) => (
                      <div
                        key={permission}
                        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                      >
                        <Badge variant={entry.effect === 'ALLOW' ? 'success' : 'destructive'} className="text-[10px] shrink-0">
                          {entry.effect}
                        </Badge>
                        <span className="text-sm truncate flex-1" title={permission}>
                          {permissionMeta.get(permission)?.label ?? permission}
                        </span>
                        <input
                          type="date"
                          disabled={isSaving}
                          value={entry.expiresAt ? entry.expiresAt.slice(0, 10) : ''}
                          onChange={(e) => setExpiry(permission, e.target.value)}
                          className="h-8 rounded-lg border border-border bg-background px-2 text-xs disabled:opacity-50"
                          title="Optional expiration date"
                        />
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => removeOverride(permission)}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                          title="Remove override"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <p className="flex items-start gap-1.5 text-xs text-muted-foreground pt-1">
                  <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  Saving replaces this user&apos;s entire override set with what&apos;s shown above.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
            <Button type="button" onClick={onSave} disabled={isSaving || isLoading || isError}>
              {isSaving ? 'Saving...' : 'Save Overrides'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmCloseOpen}
        onOpenChange={setConfirmCloseOpen}
        title="Discard changes?"
        description="You have unsaved permission override changes. Closing now will discard them."
        onConfirm={() => { setConfirmCloseOpen(false); onOpenChange(false); }}
        confirmLabel="Discard"
      />
    </>
  );
}
