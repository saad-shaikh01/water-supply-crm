'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { cloneRoleSchema, type CloneRoleFormInput } from '../schemas';
import { useCloneRole } from '../hooks/use-roles';
import type { RoleSummary } from '../api/roles.api';

interface CloneRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: RoleSummary | null;
}

/** Clones a role's full permission set under a new name — no permission editing here;
 * the server copies `source`'s grants verbatim (`RoleService.clone()`). */
export function CloneRoleDialog({ open, onOpenChange, source }: CloneRoleDialogProps) {
  const { mutate: clone, isPending } = useCloneRole();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CloneRoleFormInput>({
    resolver: zodResolver(cloneRoleSchema),
  });

  useEffect(() => {
    if (open && source) {
      reset({ name: `${source.name} (Copy)`, description: source.description ?? '' });
    }
  }, [open, source, reset]);

  const onSubmit = (data: CloneRoleFormInput) => {
    if (!source) return;
    const payload = { name: data.name, ...(data.description ? { description: data.description } : {}) };
    clone({ id: source.id, data: payload }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Clone Role</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>New role name</Label>
            <Input placeholder="e.g. Accountant (Copy)" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Input placeholder="What this role is for" {...register('description')} />
            {errors.description && <p className="text-sm text-destructive">{errors.description.message}</p>}
          </div>
          <p className="text-xs text-muted-foreground">
            Copies all {source?.permissionCount ?? 0} permission{source?.permissionCount === 1 ? '' : 's'} from
            &ldquo;{source?.name}&rdquo; into a new custom role.
          </p>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending ? 'Cloning...' : 'Clone'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
