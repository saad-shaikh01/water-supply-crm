'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  DataTablePagination,
  Card,
  CardContent,
  cn,
} from '@water-supply-crm/ui';
import { Calendar, FileText, Inbox } from 'lucide-react';
import { useTransactions } from '../hooks/use-transactions';
import { ListEmptyState, ListErrorState, ListLoadingState } from '../../../components/shared/list-states';

interface TransactionListProps {
  typeFilter?: string;
}

export function TransactionList({ typeFilter }: TransactionListProps) {
  const { data, isLoading, isError, refetch, page, setPage, limit, setLimit } = useTransactions();

  const response = data as { data?: any[]; meta?: { total: number } } | undefined;
  const transactions = response?.data ?? [];
  const total = response?.meta?.total ?? 0;

  if (isLoading) {
    return <ListLoadingState rows={4} />;
  }

  if (isError) {
    return (
      <ListErrorState
        icon={Inbox}
        title="Failed to load transactions"
        description="Please retry to load your transaction history."
        onRetry={() => refetch()}
      />
    );
  }

  if (transactions.length === 0) {
    return (
      <ListEmptyState
        icon={Inbox}
        title="No transactions found"
        description={
          typeFilter
            ? 'No transactions match the selected type.'
            : 'Your transaction history will appear here.'
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 sm:hidden">
        {transactions.map((tx: any) => {
          const isPayment = tx.amount < 0;
          return (
            <Card key={tx.id} className="rounded-2xl border-border/50 bg-card/50 dark:glass-surface">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <p className="text-sm font-bold truncate">{tx.description || tx.type.replace('_', ' ')}</p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(tx.createdAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <Badge variant={isPayment ? 'success' : 'outline'} className="text-[9px] font-black tracking-widest shrink-0">
                    {tx.type}
                  </Badge>
                </div>
                <p className={cn('text-right font-mono font-black text-base', isPayment ? 'text-emerald-500' : 'text-destructive')}>
                  {isPayment ? '-' : '+'} Rs {Math.abs(tx.amount).toLocaleString()}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="hidden sm:block rounded-2xl border border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden shadow-sm dark:glass-surface">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20 hover:bg-muted/20 border-b border-border/50 transition-colors">
              <TableHead className="h-12 text-[10px] uppercase tracking-widest font-black text-muted-foreground pl-6">Date</TableHead>
              <TableHead className="h-12 text-[10px] uppercase tracking-widest font-black text-muted-foreground">Description</TableHead>
              <TableHead className="h-12 text-[10px] uppercase tracking-widest font-black text-muted-foreground">Type</TableHead>
              <TableHead className="h-12 text-[10px] uppercase tracking-widest font-black text-muted-foreground text-right pr-6">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((tx: any, idx: number) => {
              const isPayment = tx.amount < 0;
              return (
                <TableRow
                  key={tx.id}
                  className={cn(
                    'group transition-colors border-b border-border/50 last:border-0 hover:bg-primary/[0.02]',
                    idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/5'
                  )}
                >
                  <TableCell className="py-4 pl-6">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span className="text-[11px] font-bold uppercase tracking-tighter">
                        {new Date(tx.createdAt).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="h-3 w-3 text-muted-foreground opacity-50" />
                      <span className="text-sm font-bold group-hover:text-primary transition-colors">
                        {tx.description || tx.type.replace('_', ' ')}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={isPayment ? 'success' : 'outline'} className="text-[9px] font-black tracking-widest">
                      {tx.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <div className={cn('font-mono font-black text-sm', isPayment ? 'text-emerald-500' : 'text-destructive')}>
                      {isPayment ? '-' : '+'} Rs {Math.abs(tx.amount).toLocaleString()}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination page={page} limit={limit} total={total} onPageChange={setPage} onLimitChange={setLimit} />
    </div>
  );
}
