'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import { PageHeader } from '../../../../components/shared/page-header';
import { Button, Skeleton } from '@water-supply-crm/ui';

const RouteHistoryExplorer = dynamic(
  () => import('../../../../features/tracking/components/route-history-explorer').then((m) => m.RouteHistoryExplorer),
  { ssr: false, loading: () => <Skeleton className="h-[600px] w-full rounded-3xl" /> }
);

export default function TrackingHistoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Route History"
        description="Replay a driver's full day — route, stops with duration, and delivery timeline."
        action={
          <Button variant="outline" className="rounded-xl gap-2" asChild>
            <Link href="/dashboard/tracking">
              <Activity className="h-4 w-4" />
              Back to Live Tracking
            </Link>
          </Button>
        }
      />

      <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-3xl" />}>
        <RouteHistoryExplorer />
      </Suspense>
    </div>
  );
}
