import { Suspense } from 'react';
import { PlatformAdminsPageClient } from '../../../../features/platform-admins/components/platform-admins-page-client';

export default function PlatformAdminsPage() {
  return (
    <Suspense fallback={<div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Loading administrators...</div>}>
      <PlatformAdminsPageClient />
    </Suspense>
  );
}
