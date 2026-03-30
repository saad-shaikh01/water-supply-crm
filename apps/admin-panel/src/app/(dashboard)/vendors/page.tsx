'use client';

import { Suspense, useState } from 'react';
import { Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { VendorList } from '../../../features/vendors/components/vendor-list';
import { VendorForm } from '../../../features/vendors/components/vendor-form';

export default function VendorsPage() {
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendors</h1>
          <p className="text-muted-foreground">Manage vendor accounts on the platform</p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Vendor
        </Button>
      </div>
      <Suspense
        fallback={
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            Loading vendors...
          </div>
        }
      >
        <VendorList />
      </Suspense>
      <VendorForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
