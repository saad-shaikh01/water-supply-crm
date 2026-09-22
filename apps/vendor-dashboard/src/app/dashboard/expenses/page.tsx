'use client';

import { useState } from 'react';
import { PageHeader } from '../../../components/shared/page-header';
import { ExpenseKpiStrip } from '../../../features/expense-center/components/expense-kpi-strip';
import { ExpenseDomainBreakdown } from '../../../features/expense-center/components/expense-domain-breakdown';
import { ExpenseSourceBreakdown } from '../../../features/expense-center/components/expense-source-breakdown';
import { ExpenseFilterToolbar } from '../../../features/expense-center/components/expense-filter-toolbar';
import { ExpenseTimeline } from '../../../features/expense-center/components/expense-timeline';
import { AddExpenseWizard } from '../../../features/expense-center/wizard/add-expense-wizard';
import { TopUpFuelCardDialog } from '../../../features/fuel-cards/components/topup-fuel-card-dialog';
import { FUEL_CARD_PERMISSIONS } from '../../../features/fuel-cards/constants';
import { useCan } from '../../../features/authz/hooks/use-can';
import { Button } from '@water-supply-crm/ui';
import { Fuel, Plus } from 'lucide-react';

export default function ExpensesPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [fuelTopUpOpen, setFuelTopUpOpen] = useState(false);
  const canTopUpFuelCard = useCan(FUEL_CARD_PERMISSIONS.topup);

  return (
    <>
      {/* Phase 2a (§04): the header action opens the Add-Expense *type picker*
          (Vehicle / Employee / Office / Inventory / Capital) that dispatches to
          the right domain form. "Top Up Fuel Card" sits next to it but is
          deliberately NOT an Expense type in that wizard — a fuel card
          top-up is a cash transfer, not a company cost (see
          docs — Fuel Card Wallet). */}
      <PageHeader
        title="Expenses"
        description="Track operational costs — fuel, maintenance, salaries and more"
        action={
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            {canTopUpFuelCard && (
              <Button
                variant="outline"
                onClick={() => setFuelTopUpOpen(true)}
                className="rounded-full px-4 sm:px-5 py-3 sm:py-6 h-auto transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm sm:text-base font-bold w-full sm:w-auto justify-center"
              >
                <Fuel className="h-4 w-4 sm:h-5 sm:w-5" />
                Top Up Fuel Card
              </Button>
            )}
            <Button
              onClick={() => setAddOpen(true)}
              className="rounded-full px-4 sm:px-5 py-3 sm:py-6 h-auto shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm sm:text-base font-bold w-full sm:w-auto justify-center"
            >
              <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
              Record Expense
            </Button>
          </div>
        }
      />
      <div className="space-y-4">
        <ExpenseKpiStrip />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ExpenseDomainBreakdown />
          <ExpenseSourceBreakdown />
        </div>
        <ExpenseFilterToolbar />
        {/* Phase 1 replaces the Expenses-only <ExpenseList /> with the unified,
            cross-source timeline. ExpenseList/ExpenseForm stay in the tree for
            the Phase 2 (§07) row-click edit-routing work (ExpenseForm is also
            reused directly by the wizard below, for its plain-Expense types). */}
        <ExpenseTimeline />
      </div>
      <AddExpenseWizard open={addOpen} onOpenChange={setAddOpen} />
      <TopUpFuelCardDialog open={fuelTopUpOpen} onOpenChange={setFuelTopUpOpen} />
    </>
  );
}
