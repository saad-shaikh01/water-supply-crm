'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { VanFilter } from '../../../components/shared/filters/van-filter';
import { useCan } from '../../../features/authz/hooks/use-can';
import { CashLedgerTimeline } from '../../../features/van-cash-ledger/components/cash-ledger-timeline';
import { CashLedgerStatsBar } from '../../../features/van-cash-ledger/components/cash-ledger-stats-bar';
import { SetOpeningBalanceDialog } from '../../../features/van-cash-ledger/components/set-opening-balance-dialog';
import { VAN_CASH_LEDGER_PERMISSIONS } from '../../../features/van-cash-ledger/constants';

export default function CashLedgerPage() {
  const [openingBalanceOpen, setOpeningBalanceOpen] = useState(false);
  const canManage = useCan(VAN_CASH_LEDGER_PERMISSIONS.manage);

  return (
    <>
      <PageHeader
        title="Cash Ledger"
        description="Every cash handover and cash-paid expense per van, in one running balance"
        action={
          canManage ? (
            <Button
              onClick={() => setOpeningBalanceOpen(true)}
              className="rounded-full px-4 sm:px-5 py-3 sm:py-6 h-auto shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm sm:text-base font-bold w-full sm:w-auto justify-center"
            >
              <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
              Set Opening Balance
            </Button>
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

      <SetOpeningBalanceDialog open={openingBalanceOpen} onOpenChange={setOpeningBalanceOpen} />
    </>
  );
}
