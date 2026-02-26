import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import { ticketsApi } from '../api/tickets.api';

export const useTickets = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [type, setType] = useQueryState('type', parseAsString.withDefault(''));
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [priority, setPriority] = useQueryState('priority', parseAsString.withDefault(''));
  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));
  const [from, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [to, setTo] = useQueryState('to', parseAsString.withDefault(''));

  const params = {
    page,
    limit,
    type: type || undefined,
    status: status || undefined,
    priority: priority || undefined,
    search: search || undefined,
    dateFrom: from || undefined,
    dateTo: to || undefined,
  };

  return {
    ...useQuery({
      queryKey: ['vendor-tickets', params],
      queryFn: () => ticketsApi.getAll(params).then((r) => r.data),
    }),
    page,
    setPage,
    limit,
    setLimit,
    type,
    setType,
    status,
    setStatus,
    priority,
    setPriority,
    search,
    setSearch,
    from,
    setFrom,
    to,
    setTo,
  };
};

export const useReplyTicket = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, vendorReply, status }: { id: string; vendorReply: string; status?: string }) =>
      ticketsApi.reply(id, { vendorReply, status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-tickets'] });
      toast.success('Reply submitted');
    },
    onError: () => toast.error('Failed to submit reply'),
  });
};
