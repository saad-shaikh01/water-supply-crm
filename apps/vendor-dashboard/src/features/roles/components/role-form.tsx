'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
  Button, Input, Label, Skeleton,
} from '@water-supply-crm/ui';
import { expandPattern, type Permission } from '@water-supply-crm/authz';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { roleSchema, type RoleInput } from '../schemas';
import { useCreateRole, useUpdateRole, useRole } from '../hooks/use-roles';
import { usePermissionCatalog } from '../hooks/use-permission-catalog';
import { PermissionMatrix } from './permission-matrix';
import type { RoleSummary } from '../api/roles.api';

interface RoleFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: RoleSummary | null;
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Create/edit shell for a role, including its permission set via `PermissionMatrix`.
 * A role's stored grants may include wildcards (`*`, `resource:*` — e.g. the seeded
 * Vendor Admin preset), which `expandPattern` expands into concrete catalog permissions
 * before they're shown as checked — otherwise a wildcard role would render as "nothing
 * selected" and a save would wipe it down to an empty permission set. Saving always
 * sends the complete, catalog-ordered permission array (never incremental).
 */
export function RoleForm({ open, onOpenChange, role }: RoleFormProps) {
  const isEdit = !!role?.id;
  const { mutate: create, isPending: isCreating } = useCreateRole();
  const { mutate: update, isPending: isUpdating } = useUpdateRole();
  const isPending = isCreating || isUpdating;

  const { data: roleDetail, isLoading: isLoadingDetail, isError: isDetailError } = useRole(
    isEdit && open ? (role as RoleSummary).id : null,
  );
  const { data: catalogGroups } = usePermissionCatalog();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty: isFieldsDirty },
  } = useForm<RoleInput>({ resolver: zodResolver(roleSchema) });

  const [selectedPermissions, setSelectedPermissions] = useState<Set<Permission>>(new Set());
  const [initialPermissions, setInitialPermissions] = useState<Set<Permission>>(new Set());
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (role) {
      reset({ name: role.name, description: role.description ?? '', color: role.color ?? '' });
    } else {
      reset({ name: '', description: '', color: '' });
      setSelectedPermissions(new Set());
      setInitialPermissions(new Set());
    }
  }, [open, role, reset]);

  useEffect(() => {
    if (!open || !isEdit || !roleDetail) return;
    const concrete = new Set<Permission>();
    for (const pattern of roleDetail.permissions) {
      for (const permission of expandPattern(pattern)) concrete.add(permission);
    }
    setSelectedPermissions(concrete);
    setInitialPermissions(new Set(concrete));
  }, [open, isEdit, roleDetail]);

  const hasUnsavedChanges = isFieldsDirty || !setsEqual(selectedPermissions, initialPermissions);

  useEffect(() => {
    if (!open || !hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [open, hasUnsavedChanges]);

  const requestClose = () => {
    if (hasUnsavedChanges) setConfirmCloseOpen(true);
    else onOpenChange(false);
  };

  // Flat, catalog-ordered permission list (resource, then action, as the backend returns
  // it) — submission filters this down to what's checked, so the payload preserves the
  // backend's own ordering and can never contain a permission the catalog doesn't know.
  const orderedPermissions = useMemo(
    () => (catalogGroups ?? []).flatMap((group) => group.permissions.map((p) => p.key as Permission)),
    [catalogGroups],
  );

  const onSubmit = (data: RoleInput) => {
    const permissions = orderedPermissions.filter((p) => selectedPermissions.has(p));
    const payload = {
      name: data.name,
      ...(data.description ? { description: data.description } : {}),
      ...(data.color ? { color: data.color } : {}),
      permissions,
    };

    if (isEdit) {
      update({ id: (role as RoleSummary).id, data: payload }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(payload, { onSuccess: () => onOpenChange(false) });
    }
  };

  const showMatrixLoading = isEdit && (isLoadingDetail || !roleDetail);

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) requestClose(); }}>
        <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{isEdit ? 'Edit Role' : 'Create Role'}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input placeholder="e.g. Accountant" {...register('name')} />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Input placeholder="What this role is for" {...register('description')} />
              {errors.description && <p className="text-sm text-destructive">{errors.description.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Color (optional)</Label>
              <Input type="color" className="h-11 w-20 p-1" {...register('color')} />
              {errors.color && <p className="text-sm text-destructive">{errors.color.message}</p>}
            </div>

            <div className="pt-2 border-t border-border/50">
              {showMatrixLoading ? (
                <div className="space-y-2 pt-3">
                  <Skeleton className="h-10 w-full rounded-xl" />
                  <Skeleton className="h-10 w-full rounded-xl" />
                  <Skeleton className="h-10 w-full rounded-xl" />
                </div>
              ) : isDetailError ? (
                <p className="text-sm text-destructive pt-3">Failed to load this role&apos;s permissions.</p>
              ) : (
                <div className="pt-3">
                  <PermissionMatrix
                    selected={selectedPermissions}
                    onChange={setSelectedPermissions}
                    isSystem={role?.isSystem}
                    disabled={isPending}
                  />
                </div>
              )}
            </div>

            <SheetFooter className="pt-4">
              <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
              <Button type="submit" disabled={isPending}>{isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmCloseOpen}
        onOpenChange={setConfirmCloseOpen}
        title="Discard changes?"
        description="You have unsaved changes to this role. Closing now will discard them."
        onConfirm={() => { setConfirmCloseOpen(false); onOpenChange(false); }}
        confirmLabel="Discard"
      />
    </>
  );
}
