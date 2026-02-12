import { TransactionList } from '../../../features/transactions/components/transaction-list';

export default function TransactionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Transactions</h1>
        <p className="text-sm text-muted-foreground">Your full transaction history</p>
      </div>

      <TransactionList />
    </div>
  );
}
