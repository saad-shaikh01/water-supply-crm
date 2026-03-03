'use client';

import { useState } from 'react';
import { Button } from '@water-supply-crm/ui';
import { Plus, UserPlus } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { CustomerList } from '../../../features/customers/components/customer-list';
import { CustomerForm } from '../../../features/customers/components/customer-form';

export default function CustomersPage() {
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Lists"
        description="Manage your customer base, delivery schedules, and wallet balances."
        action={
          <Button 
            onClick={() => setFormOpen(true)}
            className="rounded-full px-4 sm:px-5 py-3 sm:py-6 h-auto shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm sm:text-base font-bold w-full sm:w-auto justify-center"
          >
            <UserPlus className="h-4 w-4 sm:h-5 sm:w-5" />
            Add New Customer
          </Button>
        }
      />
      <div className="bg-background/50 backdrop-blur-sm rounded-3xl">
        <CustomerList onAdd={() => setFormOpen(true)} />
      </div>
      <CustomerForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
