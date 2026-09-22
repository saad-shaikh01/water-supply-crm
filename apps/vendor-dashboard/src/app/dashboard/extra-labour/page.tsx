'use client';

import { Suspense } from 'react';
import { PageHeader } from '../../../components/shared/page-header';
import { ExtraLabourList } from '../../../features/extra-labour/components/extra-labour-list';
import { useCan } from '../../../features/authz/hooks/use-can';

function ExtraLabourContent() {
  const canPage = useCan('extra_labour:page');
  const canCreate = useCan('extra_labour:create');
  const canManageTypes = useCan('extra_labour:manage');

  if (!canPage) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        You do not have permission to view the Extra Labour roster.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Extra Labour"
        description="Manage temporary workers, loaders, helpers, and track wage payouts."
      />

      <ExtraLabourList canCreate={canCreate} canManageTypes={canManageTypes} />
    </div>
  );
}

export default function ExtraLabourPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-accent/30 animate-pulse" />}>
      <ExtraLabourContent />
    </Suspense>
  );
}
