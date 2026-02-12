import { WalletCard } from '../../../features/wallet/components/wallet-card';
import { RecentTransactions } from '../../../features/wallet/components/recent-transactions';

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">Your account at a glance</p>
      </div>

      <WalletCard />
      <RecentTransactions />
    </div>
  );
}
