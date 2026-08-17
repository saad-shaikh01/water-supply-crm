'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { PageHeader } from '../../../components/shared/page-header';
import { History } from 'lucide-react';
import { Button, Skeleton } from '@water-supply-crm/ui';

const TrackingMap = dynamic(
  () => import('../../../features/tracking/components/tracking-map').then((m) => m.TrackingMap),
  { ssr: false, loading: () => <Skeleton className="h-[500px] w-full rounded-3xl" /> }
);

const MissingLocationPanel = dynamic(
  () => import('../../../features/tracking/components/missing-location-panel').then((m) => m.MissingLocationPanel),
  { ssr: false }
);

export default function TrackingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Fleet Tracking"
        description="Monitor your delivery fleet in real-time. Track locations, speeds, and delivery progress."
        action={
          <div className="flex items-center gap-3">
            <Button variant="outline" className="rounded-xl gap-2" asChild>
              <Link href="/dashboard/tracking/history">
                <History className="h-4 w-4" />
                Route History
              </Link>
            </Button>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              <span className="text-xs font-black uppercase tracking-widest">Real-time Stream</span>
            </div>
          </div>
        }
      />

      <MissingLocationPanel />
      <TrackingMap />
    </div>
  );
}
