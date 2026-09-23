import { useQuery } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import {
  expenseCenterApi,
  type ExpenseCenterDomain,
  type ExpenseCenterSourceBucket,
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
  const [domain, setDomainState] = useQueryState('domain', parseAsString.withDefault(''));
  const [category, setCategoryState] = useQueryState('category', parseAsString.withDefault(''));
  const [vanId, setVanIdState] = useQueryState('vanId', parseAsString.withDefault(''));
  const [employeeId, setEmployeeIdState] = useQueryState('employeeId', parseAsString.withDefault(''));
  const [extraLabourId, setExtraLabourIdState] = useQueryState('extraLabourId', parseAsString.withDefault(''));
  const [paymentMethod, setPaymentMethodState] = useQueryState('paymentMethod', parseAsString.withDefault(''));
  const [source, setSourceState] = useQueryState('source', parseAsString.withDefault(''));
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));

  const params: ExpenseCenterTimelineQuery = {
    page,
    limit,
    domain: (domain as ExpenseCenterDomain) || undefined,
    category: category || undefined,
    vanId: vanId || undefined,
    employeeId: employeeId || undefined,
    extraLabourId: extraLabourId || undefined,
    paymentMethod: paymentMethod || undefined,
    source: (source as ExpenseCenterSourceBucket) || undefined,
    from: from || undefined,
    to: to || undefined,
  };

  /**
   * Narrowing the result set has to send the reader back to page 1 — otherwise
   * a filter applied while sitting on page 4 lands on an empty page.
   */
  const applyDomain = (next: string | null) => { void setDomainState(next); void setPage(1); };
  const applyCategory = (next: string | null) => { void setCategoryState(next); void setPage(1); };
  const applyVanId = (next: string | null) => { void setVanIdState(next); void setPage(1); };
  const applyEmployeeId = (next: string | null) => { void setEmployeeIdState(next); void setPage(1); };
  const applyExtraLabourId = (next: string | null) => { void setExtraLabourIdState(next); void setPage(1); };
  const applyPaymentMethod = (next: string | null) => { void setPaymentMethodState(next); void setPage(1); };
  const applySource = (next: string | null) => { void setSourceState(next); void setPage(1); };

  /** Clears every filter (never touches `from`/`to`, which the date range picker owns). */
  const clearFilters = () => {
    void setDomainState(null);
    void setCategoryState(null);
    void setVanIdState(null);
    void setEmployeeIdState(null);
    void setExtraLabourIdState(null);
    void setPaymentMethodState(null);
    void setSourceState(null);
    void setPage(1);
  };

  const activeCount = [domain, category, vanId, employeeId, extraLabourId, paymentMethod, source].filter(Boolean).length;

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
    vanId,
    setVanId: applyVanId,
    employeeId,
    setEmployeeId: applyEmployeeId,
    extraLabourId,
    setExtraLabourId: applyExtraLabourId,
    paymentMethod,
    setPaymentMethod: applyPaymentMethod,
    source,
    setSource: applySource,
    clearFilters,
    activeCount,
    from,
    to,
  };
};
