'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { productSchema, type ProductInput } from '../schemas';
import { useCreateProduct, useUpdateProduct } from '../hooks/use-products';
import { Package, DollarSign } from 'lucide-react';

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
    defaultValues: { name: '', description: '', basePrice: 0 },
  });

  useEffect(() => {
    if (open && product) {
      reset({
        name: String(product.name ?? ''),
        description: String(product.description ?? ''),
        basePrice: Number(product.basePrice ?? 0),
      });
    } else if (!open) {
      reset({ name: '', description: '', basePrice: 0 });
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
      <SheetContent className="w-full sm:max-w-md bg-background/95 backdrop-blur-xl border-l border-border/50">
        <SheetHeader className="pb-6 border-b">
          <SheetTitle className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6 text-primary" />
            {isEdit ? 'Update Product' : 'Add Product'}
          </SheetTitle>
          <SheetDescription>
            {isEdit ? 'Update the product details and pricing.' : 'Add a new product to your inventory.'}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-8">
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Product Name</Label>
            <Input 
              placeholder="e.g. 19L Mineral Water" 
              className="bg-accent/30 border-border/50 h-11 focus:border-primary/50 transition-all"
              {...register('name')} 
            />
            {errors.name && <p className="text-xs font-medium text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Description</Label>
            <Input 
              placeholder="Brief description of the product" 
              className="bg-accent/30 border-border/50 h-11 focus:border-primary/50 transition-all"
              {...register('description')} 
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Base Price (₨)</Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                type="number" 
                step="0.01" 
                min={0} 
                placeholder="0.00" 
                className="pl-9 bg-accent/30 border-border/50 h-11 focus:border-primary/50 transition-all font-mono font-bold"
                {...register('basePrice', { valueAsNumber: true })} 
              />
            </div>
            {errors.basePrice && <p className="text-xs font-medium text-destructive">{errors.basePrice.message}</p>}
            <p className="text-[11px] text-muted-foreground mt-1">
              This is the default price for customers without custom pricing.
            </p>
          </div>

          <SheetFooter className="pt-6 border-t gap-3 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Discard
            </Button>
            <Button type="submit" className="min-w-[120px] shadow-lg shadow-primary/20" disabled={isPending}>
              {isPending ? 'Saving...' : isEdit ? 'Update Product' : 'Create Product'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
