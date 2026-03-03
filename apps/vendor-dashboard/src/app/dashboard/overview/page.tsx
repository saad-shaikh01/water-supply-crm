'use client';

import dynamic from 'next/dynamic';
import { OverviewStats } from '../../../features/dashboard/components/overview-stats';
import { PageHeader } from '../../../components/shared/page-header';
import { Skeleton } from '@water-supply-crm/ui';
import { OperationsCockpit } from '../../../features/dashboard/components/operations-cockpit';

// Heavy components lazy loaded - OVR-008
const RevenueChart = dynamic(() => import('../../../features/dashboard/components/revenue-chart').then(mod => mod.RevenueChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[350px] w-full rounded-3xl" />
});

const TopCustomersWidget = dynamic(() => import('../../../features/dashboard/components/top-customers-widget').then(mod => mod.TopCustomersWidget), {
  ssr: false,
  loading: () => <Skeleton className="h-[350px] w-full rounded-3xl" />
});

const RoutePerformanceWidget = dynamic(() => import('../../../features/dashboard/components/route-performance-widget').then(mod => mod.RoutePerformanceWidget), {
  ssr: false,
  loading: () => <Skeleton className="h-[350px] w-full rounded-3xl" />
});

const StaffPerformanceWidget = dynamic(() => import('../../../features/dashboard/components/staff-performance-widget').then(mod => mod.StaffPerformanceWidget), {
  ssr: false,
  loading: () => <Skeleton className="h-[350px] w-full rounded-3xl" />
});

export default function OverviewPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Overview" description="Your business at a glance" />
      
      <div className="space-y-6">
        <OverviewStats />
        <OperationsCockpit />
      </div>

      <div className="grid gap-6 lg:grid-cols-7">
        <div className="lg:col-span-4">
          <RevenueChart />
        </div>
        <div className="lg:col-span-3">
          <TopCustomersWidget />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <RoutePerformanceWidget />
        <StaffPerformanceWidget />
      </div>
    </div>
  );
}
