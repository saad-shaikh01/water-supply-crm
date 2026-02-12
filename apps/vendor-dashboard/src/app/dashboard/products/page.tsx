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
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
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
