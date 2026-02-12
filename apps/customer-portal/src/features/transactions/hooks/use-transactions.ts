import { useQuery } from '@tanstack/react-query';
import { parseAsInteger, useQueryState } from 'nuqs';
import { transactionsApi } from '../api/transactions.api';
import { useAuthStore } from '../../../store/auth.store';
import { queryKeys } from '../../../lib/query-keys';

export const useTransactions = () => {
  const user = useAuthStore((s) => s.user);
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));

  const query = useQuery({
    queryKey: queryKeys.transactions.all(user?.customerId ?? '', { page, limit: 20 }),
    queryFn: () =>
      transactionsApi.getAll(user!.customerId, { page, limit: 20 }).then((r) => r.data),
    enabled: !!user?.customerId,
  });

  return { ...query, page, setPage };
};
