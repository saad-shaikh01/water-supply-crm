import { Suspense } from 'react';
import { BillingPageClient } from '../../../features/billing/components/billing-page-client';

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Loading billing...</div>}>
      <BillingPageClient />
    </Suspense>
  );
}
