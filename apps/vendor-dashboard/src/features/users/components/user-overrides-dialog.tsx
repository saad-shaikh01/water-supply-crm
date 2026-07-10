'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, ShieldAlert } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Badge, Skeleton, Tabs, TabsList, TabsTrigger, TabsContent,
} from '@water-supply-crm/ui';
import { expandPattern, type Permission } from '@water-supply-crm/authz';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { PermissionMatrix } from '../../roles/components/permission-matrix';
import { usePermissionCatalog } from '../../roles/hooks/use-permission-catalog';
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
 * Per-user permission override manager. Reuses `PermissionMatrix` (D6) verbatim as three
 * views into one `OverridesMap` state — an effective-permissions read view, and two
 * editable picks (Allow / Deny) that are kept mutually exclusive per permission, since the
 * backend only accepts one override row per permission. Saves as a full replacement via
 * `PATCH /users/:id/overrides`, matching how the Role Editor always sends a complete
 * permission array rather than incremental add/remove calls.
 */
export function UserOverridesDialog({ open, onOpenChange, userId, userName }: UserOverridesDialogProps) {
  const { data: userAccess, isLoading, isError } = useUserAccess(open ? userId : null);
  const { data: catalogGroups } = usePermissionCatalog();
  const { mutate: saveOverrides, isPending: isSaving } = useSetOverrides();

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

  const allowSet = useMemo(() => {
    const set = new Set<Permission>();
    for (const [key, value] of overridesMap) if (value.effect === 'ALLOW') set.add(key);
    return set;
  }, [overridesMap]);

  const denySet = useMemo(() => {
    const set = new Set<Permission>();
    for (const [key, value] of overridesMap) if (value.effect === 'DENY') set.add(key);
    return set;
  }, [overridesMap]);

  const effectiveSet = useMemo(
    () => new Set((userAccess?.permissions ?? []) as Permission[]),
    [userAccess],
  );

  const activeOverrides = useMemo(
    () =>
      [...overridesMap.entries()].sort(
        ([a], [b]) => (permissionMeta.get(a)?.order ?? 0) - (permissionMeta.get(b)?.order ?? 0),
      ),
    [overridesMap, permissionMeta],
  );

  /** Applies a matrix's full "next selected" set as overrides of the given effect — additions
   * are written (or re-effected, preserving any expiry already set), removals are deleted
   * entirely (never left dangling as the other effect). */
  const applyChange = (next: Set<Permission>, effect: Effect) => {
    setOverridesMap((prev) => {
      const nextMap = new Map(prev);
      for (const [key, value] of prev) {
        if (value.effect === effect && !next.has(key)) nextMap.delete(key);
      }
      for (const key of next) {
        const existing = nextMap.get(key);
        if (!existing || existing.effect !== effect) {
          nextMap.set(key, { effect, expiresAt: existing?.expiresAt ?? null });
        }
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

              <Tabs defaultValue="effective">
                <TabsList>
                  <TabsTrigger value="effective">Effective Permissions</TabsTrigger>
                  <TabsTrigger value="allow">Allow Overrides</TabsTrigger>
                  <TabsTrigger value="deny">Deny Overrides</TabsTrigger>
                </TabsList>

                <TabsContent value="effective" className="pt-3">
                  <p className="text-xs text-muted-foreground pb-2">
                    What this user can currently do, from their role plus any active overrides below.
                  </p>
                  <PermissionMatrix selected={effectiveSet} onChange={() => undefined} disabled />
                </TabsContent>

                <TabsContent value="allow" className="pt-3">
                  <p className="text-xs text-muted-foreground pb-2">
                    Grant permissions this user&apos;s role wouldn&apos;t otherwise allow.
                  </p>
                  <PermissionMatrix
                    selected={allowSet}
                    onChange={(next) => applyChange(next, 'ALLOW')}
                    disabled={isSaving}
                  />
                </TabsContent>

                <TabsContent value="deny" className="pt-3">
                  <p className="text-xs text-muted-foreground pb-2">
                    Block permissions this user&apos;s role would otherwise allow. Deny always wins.
                  </p>
                  <PermissionMatrix
                    selected={denySet}
                    onChange={(next) => applyChange(next, 'DENY')}
                    disabled={isSaving}
                  />
                </TabsContent>
              </Tabs>

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
