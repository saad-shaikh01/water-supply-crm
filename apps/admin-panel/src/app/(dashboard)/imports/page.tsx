import { Suspense } from 'react';
import { ImportsPageClient } from '../../../features/imports/components/imports-page-client';

export default function ImportsPage() {
  return (
    <Suspense fallback={<div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Loading imports...</div>}>
      <ImportsPageClient />
    </Suspense>
  );
}
