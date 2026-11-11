'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, Button, Input, Label } from '@water-supply-crm/ui';
import { editVendorSchema, type EditVendorInput } from '../schemas';
import { useUpdateVendor } from '../hooks/use-vendors';

interface VendorFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: { id?: unknown; name?: unknown; slug?: unknown; address?: unknown; raastId?: unknown } | null;
}

/**
 * Edit-vendor sheet. Creating a vendor is the wizard's job (see wizard/create-vendor-wizard).
 * The slug is shown read-only and is never part of the PATCH body (the API has no slug on UpdateVendorDto).
 */
export function VendorForm({ open, onOpenChange, vendor }: VendorFormProps) {
  const { mutate: update, isPending } = useUpdateVendor();

  const form = useForm<EditVendorInput>({
    resolver: zodResolver(editVendorSchema),
    defaultValues: { name: '', address: '', raastId: '' },
  });

  useEffect(() => {
    if (open && vendor) {
      form.reset({ name: String(vendor.name ?? ''), address: String(vendor.address ?? ''), raastId: String(vendor.raastId ?? '') });
    } else if (!open) {
      form.reset();
    }
  }, [open, vendor, form]);

  const onSubmit = (data: EditVendorInput) => {
    // name always; optional fields only when they changed. Never the slug.
    const payload: Record<string, string> = { name: data.name };
    if ((data.address ?? '') !== String(vendor?.address ?? '')) payload.address = data.address ?? '';
    if ((data.raastId ?? '') !== String(vendor?.raastId ?? '')) payload.raastId = data.raastId ?? '';
    update({ id: String(vendor?.id), data: payload }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Vendor</SheetTitle>
        </SheetHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label htmlFor="vendor-name">Vendor Name</Label>
            <Input id="vendor-name" placeholder="Acme Water Co." {...form.register('name')} />
            {form.formState.errors.name && <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendor-slug">Slug</Label>
            <Input id="vendor-slug" value={String(vendor?.slug ?? '')} readOnly aria-readonly="true" className="bg-muted font-mono" />
            <p className="text-xs text-muted-foreground">The slug is the vendor&apos;s permanent identifier and cannot be changed.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendor-address">Address</Label>
            <Input id="vendor-address" {...form.register('address')} />
            {form.formState.errors.address && <p className="text-sm text-destructive">{form.formState.errors.address.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendor-raast">Raast ID</Label>
            <Input id="vendor-raast" {...form.register('raastId')} />
            {form.formState.errors.raastId && <p className="text-sm text-destructive">{form.formState.errors.raastId.message}</p>}
          </div>
          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : 'Update'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
