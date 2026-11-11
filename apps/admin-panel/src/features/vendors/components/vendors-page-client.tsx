'use client';

import { useState } from 'react';
import { Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { VendorList } from './vendor-list';
import { CreateVendorWizard } from './wizard/create-vendor-wizard';
import { PageHeader } from '../../../components/shared/page-header';

export function VendorsPageClient() {
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        description="Manage vendor accounts on the platform"
        actions={
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Vendor
          </Button>
        }
      />
      <VendorList onAddVendor={() => setWizardOpen(true)} />
      <CreateVendorWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}
