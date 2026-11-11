import { PageHeader } from '../../components/shared/page-header';
import { PlatformOverviewView } from '../../features/dashboard/components/platform-overview';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Platform Overview" description="Real-time stats across all vendors on the platform." />
      <PlatformOverviewView />
    </div>
  );
}
