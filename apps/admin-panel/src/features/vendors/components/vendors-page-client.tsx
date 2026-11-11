'use client';

import { useState } from 'react';
import { Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { VendorList } from './vendor-list';
import { VendorForm } from './vendor-form';
import { PageHeader } from '../../../components/shared/page-header';

export function VendorsPageClient() {
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        description="Manage vendor accounts on the platform"
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Vendor
          </Button>
        }
      />
      <VendorList onAddVendor={() => setFormOpen(true)} />
      <VendorForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
