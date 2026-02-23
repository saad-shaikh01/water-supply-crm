import dynamic from 'next/dynamic';
import { OverviewStats } from '../../../features/dashboard/components/overview-stats';
import { PageHeader } from '../../../components/shared/page-header';
import { Skeleton } from '@water-supply-crm/ui';
import { RoutePerformanceWidget } from '../../../features/dashboard/components/route-performance-widget';
import { StaffPerformanceWidget } from '../../../features/dashboard/components/staff-performance-widget';
import { TopCustomersWidget } from '../../../features/dashboard/components/top-customers-widget';
import { RevenueChart } from '../../../features/dashboard/components/revenue-chart';
// Heavy components lazy loaded
// const RevenueChart = dynamic(() => import('../../../features/dashboard/components/revenue-chart').then(mod => mod.RevenueChart), {
//   ssr: false,
//   loading: () => <Skeleton className="h-[350px] w-full rounded-3xl" />
// });

// const TopCustomersWidget = dynamic(() => import('../../../features/dashboard/components/top-customers-widget').then(mod => mod.TopCustomersWidget), {
//   ssr: false,
//   loading: () => <Skeleton className="h-[350px] w-full rounded-3xl" />
// });

// const RoutePerformanceWidget = dynamic(() => import('../../../features/dashboard/components/route-performance-widget').then(mod => mod.RoutePerformanceWidget), {
//   ssr: false,
// });

// const StaffPerformanceWidget = dynamic(() => import('../../../features/dashboard/components/staff-performance-widget').then(mod => mod.StaffPerformanceWidget), {
//   ssr: false,
// });

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="Your business at a glance" />
      <OverviewStats />
      <div className="grid gap-4 lg:grid-cols-7">
        <div className="lg:col-span-4">
          <RevenueChart />
        </div>
        <div className="lg:col-span-3">
          <TopCustomersWidget />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <RoutePerformanceWidget />
        <StaffPerformanceWidget />
      </div>
    </div>
  );
}
