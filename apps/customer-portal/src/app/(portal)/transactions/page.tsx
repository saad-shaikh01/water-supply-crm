import { TransactionList } from '../../../features/transactions/components/transaction-list';
import { Receipt } from 'lucide-react';

export default function TransactionsPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <Receipt className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Transaction History</h1>
          <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest text-[10px]">Full Financial Ledger</p>
        </div>
      </div>

      <TransactionList />
    </div>
  );
}
