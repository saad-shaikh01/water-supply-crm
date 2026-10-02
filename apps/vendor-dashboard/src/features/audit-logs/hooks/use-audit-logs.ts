import { useQuery } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { auditLogsApi, type AuditLogQuery } from '../api/audit-logs.api';

// The date picker keeps Asia/Karachi calendar dates (YYYY-MM-DD) in the URL;
// turn them into real instants so a "today" filter is a PKT day, not a UTC one.
const startOfDayPkt = (ymd: string) => `${ymd}T00:00:00+05:00`;
const endOfDayPkt = (ymd: string) => `${ymd}T23:59:59.999+05:00`;

export const useAuditLogs = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [entity] = useQueryState('entity', parseAsString.withDefault(''));
  const [entityId] = useQueryState('entityId', parseAsString.withDefault(''));
  const [action] = useQueryState('action', parseAsString.withDefault(''));
  const [userId] = useQueryState('userId', parseAsString.withDefault(''));
  const [customerId] = useQueryState('customerId', parseAsString.withDefault(''));
  const [search] = useQueryState('search', parseAsString.withDefault(''));
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));

  const params: AuditLogQuery = {
    page,
    limit,
    entity: entity || undefined,
    entityId: entityId || undefined,
    action: action || undefined,
    userId: userId || undefined,
    customerId: customerId || undefined,
    search: search || undefined,
    from: from ? startOfDayPkt(from) : undefined,
    to: to ? endOfDayPkt(to) : undefined,
  };

  return {
    ...useQuery({
      queryKey: ['audit-logs', params],
      queryFn: () => auditLogsApi.getAll(params).then((r) => r.data),
    }),
    page,
    setPage,
    limit,
    setLimit,
  };
};

export const useAuditFilterOptions = () =>
  useQuery({
    queryKey: ['audit-logs', 'filter-options'],
    queryFn: () => auditLogsApi.getFilterOptions().then((r) => r.data),
    staleTime: 60_000,
  });
