import { OverviewStats } from '../../features/dashboard/components/overview-stats';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Platform Overview</h1>
        <p className="text-muted-foreground">Real-time stats across all vendors on the platform.</p>
      </div>
      <OverviewStats />
    </div>
  );
}
