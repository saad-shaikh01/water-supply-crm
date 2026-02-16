import { OverviewStats } from '../../../features/dashboard/components/overview-stats';
import { RevenueChart } from '../../../features/dashboard/components/revenue-chart';
import { PageHeader } from '../../../components/shared/page-header';

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="Your business at a glance" />
      <OverviewStats />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <div className="col-span-4">
          <RevenueChart />
        </div>
      </div>
    </div>
  );
}
