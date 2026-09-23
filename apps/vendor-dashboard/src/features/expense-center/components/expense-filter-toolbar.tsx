'use client';

import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { VanFilter } from '../../../components/shared/filters/van-filter';
import { useExpenseCenterTimeline } from '../hooks/use-expense-center';
import { ExpenseDomainSelect } from './expense-domain-select';
import { ExpenseFilterDrawer } from './expense-filter-drawer';
import { ExpenseSourceChips } from './expense-source-chips';
import { ExpenseFilterChips } from './expense-filter-chips';

/**
 * Expenses page filter toolbar:
 *   row 1  date range · domain · van · Filters (category / employee / extra labour / payment method)
 *   row 2  "recorded via" source chips (Daily Sheet | Cash Ledger | Fleet | Payroll | Direct Expense)
 *   row 3  removable active-filter chips (only when a filter is active)
 */
export function ExpenseFilterToolbar() {
  const { activeCount } = useExpenseCenterTimeline();

  return (
    <div className="space-y-2.5 rounded-2xl border border-border bg-card/30 p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
        <div className="flex-1 min-w-0">
          <DateRangePicker className="w-full sm:w-auto sm:min-w-64" />
        </div>
        <ExpenseDomainSelect />
        <VanFilter />
        <ExpenseFilterDrawer />
      </div>

      <ExpenseSourceChips />

      {activeCount > 0 && <ExpenseFilterChips />}
    </div>
  );
}
