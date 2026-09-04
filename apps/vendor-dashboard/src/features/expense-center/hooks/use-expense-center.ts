import { useQuery } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import {
  expenseCenterApi,
  type ExpenseCenterDomain,
  type ExpenseCenterSummaryQuery,
  type ExpenseCenterTimelineQuery,
} from '../api/expense-center.api';

const QUERY_KEY = 'expense-center';

export const useExpenseCenterSummary = () => {
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));

  const params: ExpenseCenterSummaryQuery = {
    from: from || undefined,
    to: to || undefined,
  };

  return useQuery({
    queryKey: [QUERY_KEY, 'summary', params],
    queryFn: () => expenseCenterApi.getSummary(params).then((r) => r.data),
  });
};

export const useExpenseCenterTimeline = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [domain, setDomain] = useQueryState('domain', parseAsString.withDefault(''));
  const [category, setCategory] = useQueryState('category', parseAsString.withDefault(''));
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [employeeId] = useQueryState('employeeId', parseAsString.withDefault(''));
  const [paymentMethod] = useQueryState('paymentMethod', parseAsString.withDefault(''));
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));

  const params: ExpenseCenterTimelineQuery = {
    page,
    limit,
    domain: (domain as ExpenseCenterDomain) || undefined,
    category: category || undefined,
    vanId: vanId || undefined,
    employeeId: employeeId || undefined,
    paymentMethod: paymentMethod || undefined,
    from: from || undefined,
    to: to || undefined,
  };

  /**
   * Narrowing the result set has to send the reader back to page 1 — otherwise
   * a filter applied while sitting on page 4 lands on an empty page.
   */
  const applyDomain = (next: string | null) => {
    void setDomain(next);
    void setPage(1);
  };

  const applyCategory = (next: string | null) => {
    void setCategory(next);
    void setPage(1);
  };

  return {
    ...useQuery({
      queryKey: [QUERY_KEY, 'timeline', params],
      queryFn: () => expenseCenterApi.getTimeline(params).then((r) => r.data),
    }),
    page,
    setPage,
    limit,
    setLimit,
    domain,
    setDomain: applyDomain,
    category,
    setCategory: applyCategory,
    from,
    to,
  };
};
