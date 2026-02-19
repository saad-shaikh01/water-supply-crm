import { OverviewStats } from '../../../features/dashboard/components/overview-stats';
import { RevenueChart } from '../../../features/dashboard/components/revenue-chart';
import { TopCustomersWidget } from '../../../features/dashboard/components/top-customers-widget';
import { RoutePerformanceWidget } from '../../../features/dashboard/components/route-performance-widget';
import { StaffPerformanceWidget } from '../../../features/dashboard/components/staff-performance-widget';
import { PageHeader } from '../../../components/shared/page-header';

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
