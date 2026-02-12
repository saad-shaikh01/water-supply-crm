'use client';

import { useState } from 'react';
import { Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { CustomerList } from '../../../features/customers/components/customer-list';
import { CustomerForm } from '../../../features/customers/components/customer-form';

export default function CustomersPage() {
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Manage your customer accounts"
        action={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Customer
          </Button>
        }
      />
      <CustomerList onAdd={() => setFormOpen(true)} />
      <CustomerForm open={formOpen} onOpenChange={setFormOpen} />
    </>
  );
}
