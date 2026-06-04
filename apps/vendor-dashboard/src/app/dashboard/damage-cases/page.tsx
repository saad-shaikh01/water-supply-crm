'use client';

import { Suspense } from 'react';
import { PageHeader } from '../../../components/shared/page-header';
import { DamageCasesList } from '../../../features/damage-cases/components/damage-cases-list';

function DamageCasesContent() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Damage Cases"
        description="Review and manage bottle damage cases reported by drivers."
      />
      <DamageCasesList />
    </div>
  );
}

export default function DamageCasesPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-accent/30 animate-pulse" />}>
      <DamageCasesContent />
    </Suspense>
  );
}
