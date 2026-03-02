'use client';

import { useState } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { MoreHorizontal, Pencil, Trash2, Receipt, Fuel, Wrench, Users, AlertTriangle, type LucideIcon } from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, Badge, Card, CardContent,
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { useExpenses, useExpenseSummary, useDeleteExpense } from '../hooks/use-expenses';
import { ExpenseForm } from './expense-form';
import type { ExpenseCategory, ExpenseSummary } from '../api/expenses.api';
import { cn } from '@water-supply-crm/ui';

const CATEGORY_CONFIG: Record<ExpenseCategory, { label: string; color: string; icon: LucideIcon }> = {
  FUEL:        { label: 'Fuel',        color: 'bg-orange-500/10 text-orange-500',   icon: Fuel },
  MAINTENANCE: { label: 'Maintenance', color: 'bg-yellow-500/10 text-yellow-600',  icon: Wrench },
  SALARY:      { label: 'Salary',      color: 'bg-blue-500/10 text-blue-500',       icon: Users },
  REPAIR:      { label: 'Repair',      color: 'bg-destructive/10 text-destructive', icon: AlertTriangle },
  OTHER:       { label: 'Other',       color: 'bg-muted text-muted-foreground',     icon: Receipt },
};

export function ExpenseList() {
  const { data, isLoading, page, setPage, limit, setLimit, category } = useExpenses();
  const { data: summary } = useExpenseSummary();
  const { mutate: deleteExpense, isPending: isDeleting } = useDeleteExpense();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editExpense, setEditExpense] = useState<Record<string, unknown> | null>(null);
  const [, setCategory] = useQueryState('category', parseAsString.withDefault(''));

  const response = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const expenses = (response?.data ?? []) as Array<{
    id: string;
    amount: number;
    category: ExpenseCategory;
    description?: string;
    date: string;
    van?: { plateNumber: string };
  }>;
  const total = response?.meta?.total ?? 0;
  const summaryData = summary as ExpenseSummary | undefined;
  const categoryTotals = Object.fromEntries(
    (summaryData?.breakdown ?? []).map((item) => [item.category, item.totalAmount])
  ) as Partial<Record<ExpenseCategory, number>>;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summaryData && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.entries(CATEGORY_CONFIG).map(([cat, cfg]) => {
            const Icon = cfg.icon;
            const catTotal = categoryTotals[cat as ExpenseCategory] ?? 0;
            return (
              <Card
                key={cat}
                className={cn(
                  "bg-card/50 cursor-pointer transition-all hover:scale-[1.02] border-border/50",
                  category === cat && "ring-2 ring-primary"
                )}
                onClick={() => setCategory(category === cat ? null : cat as ExpenseCategory)}
              >
                <CardContent className="p-3 flex flex-col gap-1">
                  <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center shrink-0", cfg.color)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{cfg.label}</p>
                  <p className="font-black font-mono text-sm">₨ {Number(catTotal).toLocaleString()}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Gross Profit / Total Summary */}
      {summaryData && (
        <div className="flex flex-wrap gap-4 p-4 rounded-2xl bg-card/30 border border-border/50">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total Expenses</p>
            <p className="font-black font-mono text-lg text-destructive">₨ {Number(summaryData?.grandTotal ?? 0).toLocaleString()}</p>
          </div>
          {summaryData?.grossProfit !== undefined && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Gross Profit</p>
              <p className={cn("font-black font-mono text-lg", summaryData.grossProfit >= 0 ? "text-emerald-500" : "text-destructive")}>
                ₨ {Number(summaryData.grossProfit).toLocaleString()}
              </p>
            </div>
          )}
          {category && (
            <Button variant="ghost" size="sm" className="rounded-full text-xs self-center" onClick={() => setCategory(null)}>
              Clear filter ×
            </Button>
          )}
        </div>
      )}

      <DataTable
        data={expenses}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No expenses recorded yet"
        columns={[
          {
            key: 'category', header: 'Category',
            cell: (r) => {
              const cfg = CATEGORY_CONFIG[r.category] ?? CATEGORY_CONFIG['OTHER'];
              const Icon = cfg.icon;
              return (
                <div className="flex items-center gap-2">
                  <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center shrink-0", cfg.color)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <Badge className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border-none", cfg.color)}>
                    {cfg.label}
                  </Badge>
                </div>
              );
            }
          },
          {
            key: 'amount', header: 'Amount',
            cell: (r) => (
              <span className="font-mono font-black text-sm text-destructive">
                ₨ {Number(r.amount).toLocaleString()}
              </span>
            )
          },
          {
            key: 'date', header: 'Date',
            cell: (r) => new Date(r.date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })
          },
          {
            key: 'van', header: 'Van',
            cell: (r) => r.van?.plateNumber
              ? <Badge variant="secondary" className="text-[10px] font-mono">{r.van.plateNumber}</Badge>
              : <span className="text-muted-foreground text-xs">—</span>
          },
          {
            key: 'description', header: 'Note',
            cell: (r) => <span className="text-xs text-muted-foreground truncate max-w-[180px] block">{r.description ?? '—'}</span>
          },
          {
            key: 'actions', header: '', width: '60px',
            cell: (r) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 p-1.5 rounded-xl">
                  <DropdownMenuItem onClick={() => setEditExpense(r as Record<string, unknown>)} className="rounded-lg cursor-pointer px-2 py-2">
                    <Pencil className="mr-2 h-4 w-4 text-orange-500" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeleteId(r.id)}
                    className="rounded-lg cursor-pointer px-2 py-2 text-destructive focus:text-destructive focus:bg-destructive/10"
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="Delete Expense"
        description="Are you sure? This action cannot be undone."
        onConfirm={() => { if (deleteId) deleteExpense(deleteId, { onSuccess: () => setDeleteId(null) }); }}
        isLoading={isDeleting}
        confirmLabel="Delete"
      />

      <ExpenseForm
        open={!!editExpense}
        onOpenChange={(o) => { if (!o) setEditExpense(null); }}
        expense={editExpense}
      />
    </div>
  );
}
