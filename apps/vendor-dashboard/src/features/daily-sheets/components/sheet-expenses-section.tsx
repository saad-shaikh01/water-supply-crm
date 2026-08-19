'use client';

import { useState } from 'react';
import { Button, Card, CardContent, Badge } from '@water-supply-crm/ui';
import { Trash2, Pencil, Receipt, Fuel, Wrench, Users, AlertTriangle, CreditCard, type LucideIcon } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { useDeleteSheetExpense } from '../../expenses/hooks/use-expenses';
import { ExpenseForm } from '../../expenses/components/expense-form';
import type { SheetExpense } from '@water-supply-crm/types';

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  LUNCH_EXPENSE_EMPLOYEE:  { label: 'Lunch Exp Employee',  color: 'bg-yellow-500/10 text-yellow-600',   icon: Receipt },
  ADVANCE_SALARY_EMPLOYEE: { label: 'Adv Salary Employee', color: 'bg-blue-500/10 text-blue-500',       icon: Users },
  VEHICLE_MAINTENANCE:     { label: 'Vehicle Maintenance', color: 'bg-destructive/10 text-destructive', icon: Wrench },
  FUEL_EXPENSE:            { label: 'Fuel Exp',            color: 'bg-orange-500/10 text-orange-500',   icon: Fuel },
  OTHER:                   { label: 'Others',              color: 'bg-muted text-muted-foreground',     icon: AlertTriangle },
};

interface SheetExpensesSectionProps {
  sheetId: string;
  date: string;
  expenses: SheetExpense[];
  isClosed: boolean;
  canDelete: boolean;
  canUpdate: boolean;
}

export function SheetExpensesSection({
  sheetId,
  date,
  expenses,
  isClosed,
  canDelete,
  canUpdate,
}: SheetExpensesSectionProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editExpense, setEditExpense] = useState<SheetExpense | null>(null);
  const { mutate: deleteExpense, isPending: isDeleting } = useDeleteSheetExpense(sheetId);

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  // Only cash-paid rows are actually deducted from the driver's hand-in
  // (see daily-sheet.service.ts buildReconciliation) — the footer should
  // reflect that, not the full spend, so it doesn't look like a mismatch
  // against the Reconcile dialog right after this.
  const cashExpenses = expenses.filter((e) => e.paidFromCash !== false).reduce((s, e) => s + e.amount, 0);
  const nonCashExpenses = totalExpenses - cashExpenses;

  const canRemove = canDelete && !isClosed;
  const canEdit = canUpdate && !isClosed;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Trip Expenses</h3>
      </div>

      {expenses.length === 0 ? (
        <Card className="bg-card/30 border-border/40">
          <CardContent className="p-4 text-center text-xs text-muted-foreground">
            No expenses recorded for this trip.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {expenses.map((expense) => {
            const cfg = CATEGORY_CONFIG[expense.category] ?? CATEGORY_CONFIG['OTHER'];
            const Icon = cfg.icon;
            return (
              <Card key={expense.id} className="bg-card/50 border-border/40">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', cfg.color)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border-none', cfg.color)}>
                        {cfg.label}
                      </Badge>
                      {expense.van && (
                        <Badge variant="secondary" className="text-[10px] font-mono">{expense.van.plateNumber}</Badge>
                      )}
                      {expense.paidFromCash === false && (
                        <Badge className="text-[10px] font-bold px-2 py-0.5 rounded-full border-none bg-blue-500/10 text-blue-600 gap-1">
                          <CreditCard className="h-2.5 w-2.5" />
                          Card — not deducted
                        </Badge>
                      )}
                    </div>
                    {expense.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{expense.description}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono font-black text-sm text-destructive">
                      ₨ {Number(expense.amount).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(expense.date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-orange-500 shrink-0"
                      onClick={() => setEditExpense(expense)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canRemove && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => setDeleteId(expense.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {/* Total footer — the deducted (cash) figure leads; the card/other
              portion is shown separately so the two never get conflated. */}
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-destructive/5 border border-destructive/20">
            <p className="text-xs font-bold text-destructive uppercase tracking-widest">Deducted from Cash Hand-In</p>
            <p className="font-mono font-black text-sm text-destructive">
              ₨ {cashExpenses.toLocaleString()}
            </p>
          </div>
          {nonCashExpenses > 0 && (
            <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-blue-500/5 border border-blue-500/20">
              <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">Paid by Card (not deducted)</p>
              <p className="font-mono font-black text-sm text-blue-600">
                ₨ {nonCashExpenses.toLocaleString()}
              </p>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="Delete Expense"
        description="Are you sure? This action cannot be undone."
        onConfirm={() => {
          if (deleteId) deleteExpense(deleteId, { onSuccess: () => setDeleteId(null) });
        }}
        isLoading={isDeleting}
        confirmLabel="Delete"
      />

      {/* dailySheetId set → ExpenseForm's edit submit routes through
          useUpdateSheetExpense, so this card's own cached data refreshes
          immediately instead of only the general Expenses list. */}
      <ExpenseForm
        open={!!editExpense}
        onOpenChange={(o) => { if (!o) setEditExpense(null); }}
        expense={editExpense as unknown as Record<string, unknown> | null}
        dailySheetId={sheetId}
      />
    </div>
  );
}
