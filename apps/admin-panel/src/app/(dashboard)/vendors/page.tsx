import { Suspense } from 'react';
import { VendorsPageClient } from '../../../features/vendors/components/vendors-page-client';

export default function VendorsPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Loading vendors...
        </div>
      }
    >
      <VendorsPageClient />
    </Suspense>
  );
}
