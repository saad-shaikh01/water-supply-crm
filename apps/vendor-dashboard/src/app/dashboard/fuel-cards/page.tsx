'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { useCan } from '../../../features/authz/hooks/use-can';
import { FuelCardList } from '../../../features/fuel-cards/components/fuel-card-list';
import { TopUpHistoryList } from '../../../features/fuel-cards/components/topup-history-list';
import { CreateFuelCardDialog } from '../../../features/fuel-cards/components/create-fuel-card-dialog';
import { FUEL_CARD_PERMISSIONS } from '../../../features/fuel-cards/constants';

export default function FuelCardsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const canManage = useCan(FUEL_CARD_PERMISSIONS.manage);

  return (
    <>
      <PageHeader
        title="Fuel Cards"
        description="Register fuel cards, top them up from office cash, and track every rupee — no more counting a top-up and a fill as two separate expenses"
        action={
          canManage ? (
            <Button
              onClick={() => setCreateOpen(true)}
              className="rounded-full px-4 sm:px-5 py-3 sm:py-6 h-auto shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm sm:text-base font-bold w-full sm:w-auto justify-center"
            >
              <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
              Register Fuel Card
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-6 pb-4">
        <FuelCardList />
        <TopUpHistoryList />
      </div>

      <CreateFuelCardDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
