'use client';

import { useProducts } from '../hooks/use-products';
import { Card, CardContent, CardHeader, CardTitle, Button, DataTablePagination } from '@water-supply-crm/ui';
import { Plus, Package } from 'lucide-react';

export function ProductList() {
  const { data, isLoading, page, setPage, limit, setLimit } = useProducts();

  const response = (data as { data?: any[]; meta?: { total: number } } | undefined);
  const products = response?.data ?? [];
  const total = response?.meta?.total ?? 0;

  if (isLoading) {
    return <div className="p-8 text-center text-sm font-bold text-muted-foreground">Loading inventory...</div>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Products</CardTitle>
        </div>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Add Product
        </Button>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 transition-colors">
                <th className="h-10 px-4 text-left font-medium">Name</th>
                <th className="h-10 px-4 text-left font-medium">Base Price</th>
                <th className="h-10 px-4 text-left font-medium">Status</th>
                <th className="h-10 px-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products?.length === 0 ? (
                <tr>
                  <td colSpan={4} className="h-24 text-center text-muted-foreground">
                    No products found. Add your first product to get started.
                  </td>
                </tr>
              ) : (
                products?.map((product: any) => (
                  <tr key={product.id} className="border-b transition-colors hover:bg-muted/50">
                    <td className="p-4 flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{product.name}</span>
                    </td>
                    <td className="p-4">Rs. {product.basePrice}</td>
                    <td className="p-4">
                      <span className="px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                        Active
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <Button variant="ghost" size="sm">Edit</Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
      <DataTablePagination
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
      />
    </Card>
  );
}
