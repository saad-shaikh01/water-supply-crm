'use client';

import { useState } from 'react';
import { Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { RouteList } from '../../../features/routes/components/route-list';
import { RouteForm } from '../../../features/routes/components/route-form';

export default function RoutesPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editRoute, setEditRoute] = useState<Record<string, unknown> | null>(null);

  return (
    <>
      <PageHeader
        title="Routes"
        description="Manage delivery routes"
        action={
          <Button 
            onClick={() => setFormOpen(true)}
            className="rounded-full px-4 sm:px-5 py-3 sm:py-6 h-auto shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm sm:text-base font-bold w-full sm:w-auto justify-center"
          >
            <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
            Add Route
          </Button>
        }
      />
      <RouteList onEdit={(r) => { setEditRoute(r); setFormOpen(true); }} />
      <RouteForm
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditRoute(null); }}
        route={editRoute}
      />
    </>
  );
}
