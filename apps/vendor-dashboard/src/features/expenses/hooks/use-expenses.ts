import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger } from 'nuqs';
import { toast } from 'sonner';
import { expensesApi, type ExpenseQuery, type ExpenseCategory } from '../api/expenses.api';

const QUERY_KEY = 'expenses';

export const useExpenses = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [category] = useQueryState<ExpenseCategory | ''>('category', { defaultValue: '' });

  const params: ExpenseQuery = {
    page,
    limit,
    category: (category as ExpenseCategory) || undefined,
  };

  return {
    ...useQuery({
      queryKey: [QUERY_KEY, params],
      queryFn: () => expensesApi.getAll(params).then((r) => r.data),
    }),
    page,
    setPage,
    limit,
    setLimit,
    category,
  };
};

export const useExpenseSummary = () =>
  useQuery({
    queryKey: [QUERY_KEY, 'summary'],
    queryFn: () => expensesApi.getSummary().then((r) => r.data),
  });

export const useCreateExpense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => expensesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success('Expense recorded');
    },
    onError: () => toast.error('Failed to record expense'),
  });
};

export const useUpdateExpense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      expensesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success('Expense updated');
    },
    onError: () => toast.error('Failed to update expense'),
  });
};

export const useDeleteExpense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => expensesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success('Expense deleted');
    },
    onError: () => toast.error('Failed to delete expense'),
  });
};
