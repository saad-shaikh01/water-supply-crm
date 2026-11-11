'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@water-supply-crm/ui';
import { usePlatformAdminActions } from '../hooks/use-platform-admins';

export const createAdminSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().email('Enter a valid email address'),
  password: z
    .string()
    .optional()
    .refine((v) => !v || v.length >= 12, 'Password must be at least 12 characters'),
});
export type CreateAdminInput = z.infer<typeof createAdminSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the one-time temporary password when the API generated one. */
  onCreated: (result: { name: string; tempPassword?: string }) => void;
}

export function CreateAdminDialog({ open, onOpenChange, onCreated }: Props) {
  const { create } = usePlatformAdminActions();
  const { register, handleSubmit, reset, formState } = useForm<CreateAdminInput>({ resolver: zodResolver(createAdminSchema) });
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);
  const errors = formState.errors;

  const submit = (d: CreateAdminInput) =>
    create.mutate(
      { name: d.name, email: d.email, ...(d.password ? { password: d.password } : {}) },
      {
        onSuccess: (r) => {
          onOpenChange(false);
          onCreated({ name: r.name, tempPassword: r.tempPassword });
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add administrator</DialogTitle>
          <DialogDescription>
            Leave the password empty to generate a temporary one. The new administrator must change it at first sign-in.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="admin-name">Name</Label>
            <Input id="admin-name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">Email</Label>
            <Input id="admin-email" type="email" {...register('email')} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Password (optional)</Label>
            <Input id="admin-password" type="password" autoComplete="new-password" {...register('password')} />
            {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={create.isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating...' : 'Create administrator'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
