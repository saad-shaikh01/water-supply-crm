'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { productSchema, type ProductInput } from '../schemas';
import { useCreateProduct, useUpdateProduct } from '../hooks/use-products';

interface ProductFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Record<string, unknown> | null;
}

export function ProductForm({ open, onOpenChange, product }: ProductFormProps) {
  const isEdit = !!product?.id;
  const { mutate: create, isPending: isCreating } = useCreateProduct();
  const { mutate: update, isPending: isUpdating } = useUpdateProduct();
  const isPending = isCreating || isUpdating;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: { name: '', description: '', price: 0, unit: '', isActive: true },
  });

  useEffect(() => {
    if (open && product) {
      reset({
        name: String(product.name ?? ''),
        description: String(product.description ?? ''),
        price: Number(product.price ?? 0),
        unit: String(product.unit ?? ''),
        isActive: Boolean(product.isActive ?? true),
      });
    } else if (!open) {
      reset({ name: '', description: '', price: 0, unit: '', isActive: true });
    }
  }, [open, product, reset]);

  const onSubmit = (data: ProductInput) => {
    if (isEdit) {
      update({ id: String(product!.id), data }, { onSuccess: () => onOpenChange(false) });
    } else {
      create(data, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit Product' : 'Add Product'}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="Product name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input placeholder="Optional description" {...register('description')} />
          </div>
          <div className="space-y-2">
            <Label>Price</Label>
            <Input type="number" step="0.01" min={0} placeholder="0.00" {...register('price', { valueAsNumber: true })} />
            {errors.price && <p className="text-sm text-destructive">{errors.price.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Unit</Label>
            <Input placeholder="e.g. gallon, bottle" {...register('unit')} />
            {errors.unit && <p className="text-sm text-destructive">{errors.unit.message}</p>}
          </div>
          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
