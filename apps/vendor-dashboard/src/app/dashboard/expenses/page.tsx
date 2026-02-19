'use client';

import { useState } from 'react';
import { PageHeader } from '../../../components/shared/page-header';
import { ExpenseList } from '../../../features/expenses/components/expense-list';
import { ExpenseForm } from '../../../features/expenses/components/expense-form';
import { Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';

export default function ExpensesPage() {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Track operational costs — fuel, maintenance, salaries and more"
        action={
          <Button onClick={() => setAddOpen(true)} className="rounded-full font-bold shadow-lg shadow-primary/20">
            <Plus className="mr-2 h-4 w-4" /> Record Expense
          </Button>
        }
      />
      <ExpenseList />
      <ExpenseForm open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
