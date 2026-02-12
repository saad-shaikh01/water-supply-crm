'use client';

import { PageHeader } from '../../../components/shared/page-header';
import { TransactionList } from '../../../features/transactions/components/transaction-list';

export default function TransactionsPage() {
  return (
    <>
      <PageHeader
        title="Transactions"
        description="View all payment and adjustment records"
      />
      <TransactionList />
    </>
  );
}
