'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
  Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@water-supply-crm/ui';
import { userSchema, type UserInput } from '../schemas';
import { useCreateUser, useUpdateUser } from '../hooks/use-users';

interface UserFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: Record<string, unknown> | null;
}

export function UserForm({ open, onOpenChange, user }: UserFormProps) {
  const isEdit = !!user?.id;
  const { mutate: create, isPending: isCreating } = useCreateUser();
  const { mutate: update, isPending: isUpdating } = useUpdateUser();
  const isPending = isCreating || isUpdating;

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<UserInput>({
    resolver: zodResolver(userSchema),
  });

  useEffect(() => {
    if (open && user) {
      reset({ name: String(user.name ?? ''), email: String(user.email ?? ''), role: (user.role as UserInput['role']) ?? 'STAFF' });
    } else if (!open) {
      reset({ name: '', email: '', role: 'STAFF' });
    }
  }, [open, user, reset]);

  const onSubmit = (data: UserInput) => {
    if (isEdit) {
      const { password: _, ...updateData } = data;
      update({ id: String(user!.id), data: updateData }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(data, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader><SheetTitle>{isEdit ? 'Edit User' : 'Add User'}</SheetTitle></SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="Full name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" placeholder="email@example.com" {...register('email')} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          {!isEdit && (
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" placeholder="Min 6 characters" {...register('password')} />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
          )}
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={watch('role')} onValueChange={(v) => setValue('role', v as UserInput['role'])}>
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="VENDOR_ADMIN">Vendor Admin</SelectItem>
                <SelectItem value="STAFF">Staff</SelectItem>
                <SelectItem value="DRIVER">Driver</SelectItem>
              </SelectContent>
            </Select>
            {errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}
          </div>
          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
