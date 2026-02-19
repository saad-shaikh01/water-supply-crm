import { useQuery } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { auditLogsApi, type AuditLogQuery } from '../api/audit-logs.api';

export const useAuditLogs = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [entity] = useQueryState('entity', parseAsString.withDefault(''));
  const [action] = useQueryState('action', parseAsString.withDefault(''));

  const params: AuditLogQuery = {
    page,
    limit,
    entity: entity || undefined,
    action: action || undefined,
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
    entity,
    action,
  };
};
