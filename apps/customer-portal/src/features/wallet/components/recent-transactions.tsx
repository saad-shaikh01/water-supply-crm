'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, Badge, Skeleton } from '@water-supply-crm/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { transactionsApi } from '../../transactions/api/transactions.api';
import { useAuthStore } from '../../../store/auth.store';
import { queryKeys } from '../../../lib/query-keys';

export function RecentTransactions() {
  const user = useAuthStore((s) => s.user);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.transactions.all(user?.customerId ?? '', { limit: 5, page: 1 }),
    queryFn: () =>
      transactionsApi.getAll(user!.customerId, { limit: 5, page: 1 }).then((r) => r.data),
    enabled: !!user?.customerId,
  });

  const transactions = data?.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold">Recent Transactions</CardTitle>
        <Link
          href="/transactions"
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <p className="text-center text-muted-foreground py-8 text-sm">No transactions yet</p>
        ) : (
          <div className="space-y-3">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div>
                  <p className="text-sm font-medium">{tx.description || tx.type}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(tx.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-semibold ${
                      tx.type === 'CREDIT' ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {tx.type === 'CREDIT' ? '+' : '-'}Rs. {Math.abs(tx.amount).toLocaleString()}
                  </span>
                  <Badge variant={tx.type === 'CREDIT' ? 'default' : 'secondary'} className="text-xs">
                    {tx.type}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
