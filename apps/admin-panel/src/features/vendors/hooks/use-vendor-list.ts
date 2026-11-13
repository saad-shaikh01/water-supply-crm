import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { vendorsApi } from '../api/vendors.api';
import { queryKeys } from '../../../lib/query-keys';
import type { SortOrder, VendorSort, VendorStatusFilter } from '../types';

const STATUSES: VendorStatusFilter[] = ['all', 'active', 'suspended', 'live', 'not_live'];
const SORTS: VendorSort[] = ['createdAt', 'name', 'customers'];

/** List state lives in the URL (nuqs): ?q=&status=&sort=&order=&page=&limit= . Any filter change resets to page 1. */
export const useVendors = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [q, setQ] = useQueryState('q', parseAsString.withDefault(''));
  const [statusRaw, setStatusRaw] = useQueryState('status', parseAsString.withDefault('all'));
  const [sortRaw, setSortRaw] = useQueryState('sort', parseAsString.withDefault('createdAt'));
  const [orderRaw, setOrderRaw] = useQueryState('order', parseAsString.withDefault('desc'));

  const status = (STATUSES as string[]).includes(statusRaw) ? (statusRaw as VendorStatusFilter) : 'all';
  const sort = (SORTS as string[]).includes(sortRaw) ? (sortRaw as VendorSort) : 'createdAt';
  const order: SortOrder = orderRaw === 'asc' ? 'asc' : 'desc';

  const params = { page, limit, search: q, status, sort, order };

  return {
    ...useQuery({
      queryKey: queryKeys.vendors.list(params),
      queryFn: () => vendorsApi.getAll(params),
      placeholderData: keepPreviousData,
    }),
    page,
    setPage,
    limit,
    setLimit: (n: number) => {
      void setLimit(n);
      void setPage(1);
    },
    search: q,
    setSearch: (v: string) => {
      void setQ(v.trim() ? v : null);
      void setPage(1);
    },
    status,
    setStatus: (v: VendorStatusFilter) => {
      void setStatusRaw(v === 'all' ? null : v);
      void setPage(1);
    },
    sort,
    order,
    /** Clicking the active column flips the order; a new column starts ascending (createdAt starts descending). */
    toggleSort: (col: VendorSort) => {
      if (col === sort) void setOrderRaw(order === 'asc' ? 'desc' : 'asc');
      else {
        void setSortRaw(col);
        void setOrderRaw(col === 'createdAt' ? 'desc' : 'asc');
      }
      void setPage(1);
    },
    clearFilters: () => {
      void setQ(null);
      void setStatusRaw(null);
      void setSortRaw(null);
      void setOrderRaw(null);
      void setPage(1);
    },
    hasFilters: q.trim() !== '' || status !== 'all',
  };
};
