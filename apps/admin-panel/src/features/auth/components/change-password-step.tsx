'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, CardContent, CardFooter, Input, Label } from '@water-supply-crm/ui';
import { changePasswordSchema, type ChangePasswordInput } from '../schemas';
import { useChangeOwnPassword } from '../hooks/use-auth';

/** Shown after login when an admin signed in with a temporary password (mustChangePassword). */
export function ChangePasswordStep({ onDone }: { onDone: () => void }) {
  const change = useChangeOwnPassword();
  const { register, handleSubmit, formState } = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) });
  const errors = formState.errors;

  return (
    <form
      data-testid="change-password-step"
      onSubmit={handleSubmit((d) =>
        change.mutate({ currentPassword: d.currentPassword, newPassword: d.newPassword }, { onSuccess: onDone }),
      )}
    >
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          You signed in with a temporary password. Choose a new password to continue.
        </p>
        <div className="space-y-2">
          <Label htmlFor="currentPassword">Temporary password</Label>
          <Input id="currentPassword" type="password" autoComplete="current-password" {...register('currentPassword')} />
          {errors.currentPassword && <p className="text-sm text-destructive">{errors.currentPassword.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="newPassword">New password</Label>
          <Input id="newPassword" type="password" autoComplete="new-password" {...register('newPassword')} />
          {errors.newPassword && <p className="text-sm text-destructive">{errors.newPassword.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...register('confirmPassword')} />
          {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
        </div>
      </CardContent>
      <CardFooter>
        <Button type="submit" className="w-full" disabled={change.isPending}>
          {change.isPending ? 'Saving...' : 'Change password'}
        </Button>
      </CardFooter>
    </form>
  );
}
