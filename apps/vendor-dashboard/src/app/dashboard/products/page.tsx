'use client';

import { useState } from 'react';
import { Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { ProductList } from '../../../features/products/components/product-list';
import { ProductForm } from '../../../features/products/components/product-form';

export default function ProductsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Record<string, unknown> | null>(null);

  return (
    <>
      <PageHeader
        title="Products"
        description="Manage your product catalog"
        action={
          <Button 
            onClick={() => setFormOpen(true)}
            className="rounded-full px-4 sm:px-5 py-3 sm:py-6 h-auto shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm sm:text-base font-bold w-full sm:w-auto justify-center"
          >
            <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
            Add Product
          </Button>
        }
      />
      <ProductList onEdit={(p) => { setEditProduct(p); setFormOpen(true); }} />
      <ProductForm
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditProduct(null); }}
        product={editProduct}
      />
    </>
  );
}
