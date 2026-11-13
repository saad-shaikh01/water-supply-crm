import { Suspense } from 'react';
import { VendorDetailClient } from '../../../../features/vendors/components/detail/vendor-detail-client';

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Loading vendor...</div>}>
      <VendorDetailClient id={id} />
    </Suspense>
  );
}
