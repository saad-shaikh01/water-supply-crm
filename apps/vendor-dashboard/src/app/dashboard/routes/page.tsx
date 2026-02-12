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
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
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
