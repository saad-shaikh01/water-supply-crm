'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, Badge, Skeleton, Button } from '@water-supply-crm/ui';
import { ArrowRight, Receipt, ArrowUpRight, ArrowDownLeft, FileText, Calendar } from 'lucide-react';
import Link from 'next/link';
import { transactionsApi } from '../../transactions/api/transactions.api';
import { useAuthStore } from '../../../store/auth.store';
import { queryKeys } from '../../../lib/query-keys';
import { cn } from '@water-supply-crm/ui';

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
    <Card className="rounded-2xl border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden dark:glass-surface">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-muted/20 px-6 py-4">
        <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary" />
          Recent Activity
        </CardTitle>
        <Button variant="ghost" size="sm" asChild className="rounded-full font-bold h-8 hover:bg-primary/10 hover:text-primary transition-colors">
          <Link href="/transactions" className="flex items-center gap-1">
            History <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-6 w-16 rounded-lg" />
              </div>
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center opacity-20">
              <FileText className="h-6 w-6" />
            </div>
            <p className="text-sm font-bold text-muted-foreground">No transactions yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {transactions.map((tx: any) => {
              const isPayment = tx.amount < 0; // Negative means money received from customer
              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-4 sm:p-6 hover:bg-accent/10 transition-colors cursor-default group"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={cn(
                      "h-10 w-10 rounded-full flex items-center justify-center shrink-0 transition-colors",
                      isPayment ? "bg-emerald-500/10 text-emerald-500" : "bg-primary/10 text-primary"
                    )}>
                      {isPayment ? <ArrowDownLeft className="h-5 w-5" /> : <ArrowUpRight className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate group-hover:text-primary transition-colors">
                        {tx.description || tx.type.replace('_', ' ')}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">
                          {new Date(tx.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <p className={cn(
                      "text-sm font-black font-mono",
                      isPayment ? "text-emerald-500" : "text-destructive"
                    )}>
                      {isPayment ? '-' : '+'} ₨ {Math.abs(tx.amount).toLocaleString()}
                    </p>
                    <Badge variant="outline" className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0 mt-1 opacity-50">
                      {tx.type}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
