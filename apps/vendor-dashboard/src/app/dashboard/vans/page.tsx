'use client';

import { useState } from 'react';
import { Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { VanList } from '../../../features/vans/components/van-list';
import { VanForm } from '../../../features/vans/components/van-form';

export default function VansPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editVan, setEditVan] = useState<Record<string, unknown> | null>(null);

  return (
    <>
      <PageHeader
        title="Vans"
        description="Manage your delivery fleet"
        action={
          <Button 
            onClick={() => setFormOpen(true)}
            className="rounded-full px-4 sm:px-5 py-3 sm:py-6 h-auto shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm sm:text-base font-bold w-full sm:w-auto justify-center"
          >
            <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
            Add Van
          </Button>
        }
      />
      <VanList onEdit={(v) => { setEditVan(v); setFormOpen(true); }} />
      <VanForm
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditVan(null); }}
        van={editVan}
      />
    </>
  );
}
