'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, Button, Input, Label } from '@water-supply-crm/ui';
import { createVendorSchema, editVendorSchema, type CreateVendorInput, type EditVendorInput } from '../schemas';
import { useCreateVendor, useUpdateVendor } from '../hooks/use-vendors';

interface VendorFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: Record<string, unknown> | null;
}

export function VendorForm({ open, onOpenChange, vendor }: VendorFormProps) {
  const isEdit = !!vendor?.id;
  const { mutate: create, isPending: isCreating } = useCreateVendor();
  const { mutate: update, isPending: isUpdating } = useUpdateVendor();
  const isPending = isCreating || isUpdating;

  const createForm = useForm<CreateVendorInput>({
    resolver: zodResolver(createVendorSchema),
    defaultValues: { name: '', slug: '', adminName: '', adminEmail: '', adminPassword: '' },
  });

  const editForm = useForm<EditVendorInput>({
    resolver: zodResolver(editVendorSchema),
    defaultValues: { name: '', slug: '' },
  });

  useEffect(() => {
    if (open && isEdit && vendor) {
      editForm.reset({ name: String(vendor.name ?? ''), slug: String(vendor.slug ?? '') });
    } else if (!open) {
      createForm.reset();
      editForm.reset();
    }
  }, [open, isEdit, vendor, createForm, editForm]);

  const onCreateSubmit = (data: CreateVendorInput) => {
    create(data as unknown as Record<string, unknown>, { onSuccess: () => onOpenChange(false) });
  };

  const onEditSubmit = (data: EditVendorInput) => {
    update({ id: String(vendor!.id), data: data as unknown as Record<string, unknown> }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit Vendor' : 'Add Vendor'}</SheetTitle>
        </SheetHeader>

        {isEdit ? (
          <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label>Vendor Name</Label>
              <Input placeholder="Acme Water Co." {...editForm.register('name')} />
              {editForm.formState.errors.name && <p className="text-sm text-destructive">{editForm.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input placeholder="acme-water" {...editForm.register('slug')} />
              {editForm.formState.errors.slug && <p className="text-sm text-destructive">{editForm.formState.errors.slug.message}</p>}
            </div>
            <SheetFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending}>{isPending ? 'Saving...' : 'Update'}</Button>
            </SheetFooter>
          </form>
        ) : (
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4 mt-6">
            <p className="text-sm text-muted-foreground pb-2 border-b">Vendor Details</p>
            <div className="space-y-2">
              <Label>Vendor Name</Label>
              <Input placeholder="Acme Water Co." {...createForm.register('name')} />
              {createForm.formState.errors.name && <p className="text-sm text-destructive">{createForm.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input placeholder="acme-water" {...createForm.register('slug')} />
              {createForm.formState.errors.slug && <p className="text-sm text-destructive">{createForm.formState.errors.slug.message}</p>}
            </div>
            <p className="text-sm text-muted-foreground pb-2 border-b pt-2">Admin Account</p>
            <div className="space-y-2">
              <Label>Admin Name</Label>
              <Input placeholder="John Smith" {...createForm.register('adminName')} />
              {createForm.formState.errors.adminName && <p className="text-sm text-destructive">{createForm.formState.errors.adminName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Admin Email</Label>
              <Input type="email" placeholder="admin@acme.com" {...createForm.register('adminEmail')} />
              {createForm.formState.errors.adminEmail && <p className="text-sm text-destructive">{createForm.formState.errors.adminEmail.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Admin Password</Label>
              <Input type="password" placeholder="Min 8 characters" {...createForm.register('adminPassword')} />
              {createForm.formState.errors.adminPassword && <p className="text-sm text-destructive">{createForm.formState.errors.adminPassword.message}</p>}
            </div>
            <SheetFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending}>{isPending ? 'Creating...' : 'Create Vendor'}</Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
