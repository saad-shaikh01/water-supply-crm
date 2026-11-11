import { Suspense } from 'react';
import { AnnouncementsPageClient } from '../../../features/announcements/components/announcements-page-client';

export default function AnnouncementsPage() {
  return (
    <Suspense fallback={<div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Loading announcements...</div>}>
      <AnnouncementsPageClient />
    </Suspense>
  );
}
