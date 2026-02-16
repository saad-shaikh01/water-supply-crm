import { WalletCard } from '../../../features/wallet/components/wallet-card';
import { RecentTransactions } from '../../../features/wallet/components/recent-transactions';
import { LayoutDashboard } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <LayoutDashboard className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Dashboard</h1>
          <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest text-[10px]">Welcome back to WaterCRM</p>
        </div>
      </div>

      <WalletCard />
      <RecentTransactions />
    </div>
  );
}
