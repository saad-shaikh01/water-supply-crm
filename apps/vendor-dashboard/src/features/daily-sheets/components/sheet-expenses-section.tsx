'use client';

import { useState } from 'react';
import { Button, Card, CardContent, Badge } from '@water-supply-crm/ui';
import { Plus, Trash2, Receipt, Fuel, Wrench, Users, AlertTriangle, type LucideIcon } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { ExpenseForm } from '../../expenses/components/expense-form';
import { useDeleteSheetExpense } from '../../expenses/hooks/use-expenses';
import type { SheetExpense } from '@water-supply-crm/types';

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  FUEL:        { label: 'Fuel',        color: 'bg-orange-500/10 text-orange-500',   icon: Fuel },
  MAINTENANCE: { label: 'Maintenance', color: 'bg-yellow-500/10 text-yellow-600',  icon: Wrench },
  SALARY:      { label: 'Salary',      color: 'bg-blue-500/10 text-blue-500',       icon: Users },
  REPAIR:      { label: 'Repair',      color: 'bg-destructive/10 text-destructive', icon: AlertTriangle },
  OTHER:       { label: 'Other',       color: 'bg-muted text-muted-foreground',     icon: Receipt },
};

interface SheetExpensesSectionProps {
  sheetId: string;
  vanId?: string;
  date: string;
  expenses: SheetExpense[];
  isClosed: boolean;
  canCreate: boolean;
  canDelete: boolean;
}

export function SheetExpensesSection({
  sheetId,
  vanId,
  date,
  expenses,
  isClosed,
  canCreate,
  canDelete,
}: SheetExpensesSectionProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { mutate: deleteExpense, isPending: isDeleting } = useDeleteSheetExpense(sheetId);

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  const canAdd = canCreate && !isClosed;
  const canRemove = canDelete && !isClosed;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Trip Expenses</h3>
        {canAdd && (
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl h-8 text-xs font-bold gap-1.5"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Expense
          </Button>
        )}
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

          {/* Total footer */}
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-destructive/5 border border-destructive/20">
            <p className="text-xs font-bold text-destructive uppercase tracking-widest">Total Expenses</p>
            <p className="font-mono font-black text-sm text-destructive">
              ₨ {totalExpenses.toLocaleString()}
            </p>
          </div>
        </div>
      )}

      <ExpenseForm
        open={addOpen}
        onOpenChange={setAddOpen}
        dailySheetId={sheetId}
        defaultVanId={vanId}
      />

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
    </div>
  );
}
