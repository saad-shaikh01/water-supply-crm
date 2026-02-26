'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  Skeleton,
  DataTablePagination,
  Card,
  CardContent,
  cn,
} from '@water-supply-crm/ui';
import { Calendar, FileText, Inbox } from 'lucide-react';
import { useTransactions } from '../hooks/use-transactions';

interface TransactionListProps {
  typeFilter?: string;
}

export function TransactionList({ typeFilter }: TransactionListProps) {
  const { data, isLoading, page, setPage, limit, setLimit } = useTransactions();

  const response = data as { data?: any[]; meta?: { total: number } } | undefined;
  const allTransactions = response?.data ?? [];
  const total = response?.meta?.total ?? 0;

  // Client-side filter by type
  const transactions = typeFilter
    ? allTransactions.filter((tx: any) => tx.type === typeFilter)
    : allTransactions;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="space-y-3 sm:hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="rounded-2xl border-border/50 bg-card/50">
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="hidden sm:block rounded-2xl border border-border/50 overflow-hidden">
          <div className="h-12 bg-muted/30 border-b border-border/50" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 border-b border-border/50 last:border-0">
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 sm:hidden">
        {transactions.length === 0 ? (
          <Card className="bg-card/50">
            <CardContent className="h-64 flex flex-col items-center justify-center text-center space-y-2 opacity-60">
              <Inbox className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-bold text-muted-foreground">No transactions found</p>
            </CardContent>
          </Card>
        ) : (
          transactions.map((tx: any) => {
            const isPayment = tx.amount < 0;
            return (
              <Card key={tx.id} className="rounded-2xl border-border/50 bg-card/50">
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
          })
        )}
      </div>

      <div className="hidden sm:block rounded-[2rem] border border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20 hover:bg-muted/20 border-b border-border/50">
              <TableHead className="h-12 text-[10px] uppercase tracking-widest font-black text-muted-foreground pl-6">Date</TableHead>
              <TableHead className="h-12 text-[10px] uppercase tracking-widest font-black text-muted-foreground">Description</TableHead>
              <TableHead className="h-12 text-[10px] uppercase tracking-widest font-black text-muted-foreground">Type</TableHead>
              <TableHead className="h-12 text-[10px] uppercase tracking-widest font-black text-muted-foreground text-right pr-6">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-64 text-center">
                  <div className="flex flex-col items-center justify-center space-y-2 opacity-50">
                    <Inbox className="h-10 w-10 text-muted-foreground/50" />
                    <p className="text-sm font-bold text-muted-foreground">No transactions found</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((tx: any, idx: number) => {
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
              })
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination page={page} limit={limit} total={total} onPageChange={setPage} onLimitChange={setLimit} />
    </div>
  );
}
