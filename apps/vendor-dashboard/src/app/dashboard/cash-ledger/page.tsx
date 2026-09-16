'use client';

import { useState } from 'react';
import { Fuel, Landmark, Plus, Receipt } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { VanFilter } from '../../../components/shared/filters/van-filter';
import { useCan } from '../../../features/authz/hooks/use-can';
import { CashLedgerTimeline } from '../../../features/van-cash-ledger/components/cash-ledger-timeline';
import { CashLedgerStatsBar } from '../../../features/van-cash-ledger/components/cash-ledger-stats-bar';
import { AddCashInDialog } from '../../../features/van-cash-ledger/components/add-cash-in-dialog';
import { RecordRemittanceDialog } from '../../../features/van-cash-ledger/components/record-remittance-dialog';
import { VAN_CASH_LEDGER_PERMISSIONS } from '../../../features/van-cash-ledger/constants';
import { AddExpenseWizard } from '../../../features/expense-center/wizard/add-expense-wizard';
import { TopUpFuelCardDialog } from '../../../features/fuel-cards/components/topup-fuel-card-dialog';
import { FUEL_CARD_PERMISSIONS } from '../../../features/fuel-cards/constants';

export default function CashLedgerPage() {
  const [addCashInOpen, setAddCashInOpen] = useState(false);
  const [remittanceOpen, setRemittanceOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [fuelTopUpOpen, setFuelTopUpOpen] = useState(false);
  const canManage = useCan(VAN_CASH_LEDGER_PERMISSIONS.manage);
  const canRemit = useCan(VAN_CASH_LEDGER_PERMISSIONS.remit);
  const canCreateExpense = useCan('expenses:create');
  const canTopUpFuelCard = useCan(FUEL_CARD_PERMISSIONS.topup);

  return (
    <>
      <PageHeader
        title="Cash Ledger"
        description="Every cash handover and cash-paid expense per van, in one running balance"
        action={
          canManage || canRemit || canCreateExpense || canTopUpFuelCard ? (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              {canCreateExpense && (
                <Button
                  variant="outline"
                  onClick={() => setExpenseOpen(true)}
                  className="rounded-full px-4 sm:px-5 py-3 sm:py-6 h-auto transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm sm:text-base font-bold w-full sm:w-auto justify-center"
                >
                  <Receipt className="h-4 w-4 sm:h-5 sm:w-5" />
                  Add Expense
                </Button>
              )}
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
              {canRemit && (
                <Button
                  variant="outline"
                  onClick={() => setRemittanceOpen(true)}
                  className="rounded-full px-4 sm:px-5 py-3 sm:py-6 h-auto transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm sm:text-base font-bold w-full sm:w-auto justify-center"
                >
                  <Landmark className="h-4 w-4 sm:h-5 sm:w-5" />
                  Record Owner Handover
                </Button>
              )}
              {canManage && (
                <Button
                  onClick={() => setAddCashInOpen(true)}
                  className="rounded-full px-4 sm:px-5 py-3 sm:py-6 h-auto shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm sm:text-base font-bold w-full sm:w-auto justify-center"
                >
                  <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
                  Add Cash In
                </Button>
              )}
            </div>
          ) : undefined
        }
      />
      <div className="space-y-4 pb-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 bg-card/30 p-3 sm:p-4 rounded-2xl border border-border">
          <div className="flex-1 min-w-0">
            <VanFilter />
          </div>
          <div className="flex-1 min-w-0">
            <DateRangePicker className="w-full sm:w-auto sm:min-w-64" />
          </div>
        </div>

        <CashLedgerTimeline />
      </div>

      <CashLedgerStatsBar />

      <AddCashInDialog open={addCashInOpen} onOpenChange={setAddCashInOpen} />
      <RecordRemittanceDialog open={remittanceOpen} onOpenChange={setRemittanceOpen} />
      <AddExpenseWizard open={expenseOpen} onOpenChange={setExpenseOpen} />
      <TopUpFuelCardDialog open={fuelTopUpOpen} onOpenChange={setFuelTopUpOpen} />
    </>
  );
}
