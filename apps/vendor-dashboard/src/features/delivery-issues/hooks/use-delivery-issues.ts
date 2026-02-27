import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import { deliveryIssuesApi } from '../api/delivery-issues.api';

export const useDeliveryIssues = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [assignedToUserId, setAssignedToUserId] = useQueryState('assignedToUserId', parseAsString.withDefault(''));
  const [from, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [to, setTo] = useQueryState('to', parseAsString.withDefault(''));

  const params = {
    page,
    limit,
    status: status || undefined,
    assignedToUserId: assignedToUserId || undefined,
    dateFrom: from || undefined,
    dateTo: to || undefined,
  };

  return {
    ...useQuery({
      queryKey: ['delivery-issues', params],
      queryFn: () => deliveryIssuesApi.getAll(params).then((r) => r.data),
    }),
    page,
    setPage,
    limit,
    setLimit,
    status,
    setStatus,
    assignedToUserId,
    setAssignedToUserId,
    from,
    setFrom,
    to,
    setTo,
  };
};

export const usePlanDeliveryIssue = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: {
        nextAction: string;
        retryAt?: string;
        assignedToUserId?: string;
        assignedVanId?: string;
        assignedDriverId?: string;
        notes?: string;
      };
    }) => deliveryIssuesApi.plan(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-issues'] });
      toast.success('Issue plan updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update issue plan'),
  });
};

export const useResolveDeliveryIssue = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { resolution: string; notes?: string };
    }) => deliveryIssuesApi.resolve(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-issues'] });
      toast.success('Issue resolved');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to resolve issue'),
  });
};
