'use client';

import { Suspense } from 'react';
import { PageHeader } from '../../../components/shared/page-header';
import { DiscrepancyCasesList } from '../../../features/discrepancy-cases/components/discrepancy-cases-list';

function DiscrepancyCasesContent() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Discrepancy Cases"
        description="Review and resolve bottle/empty/cash reconciliation gaps found when daily sheets close."
      />
      <DiscrepancyCasesList />
    </div>
  );
}

export default function DiscrepancyCasesPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-accent/30 animate-pulse" />}>
      <DiscrepancyCasesContent />
    </Suspense>
  );
}
