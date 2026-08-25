import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import { deliveryIssuesApi } from '../api/delivery-issues.api';

export const useDeliveryIssues = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [assignedToUserId, setAssignedToUserId] = useQueryState('assignedToUserId', parseAsString.withDefault(''));
  const [vanId, setVanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [from, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [to, setTo] = useQueryState('to', parseAsString.withDefault(''));

  const params = {
    page,
    limit,
    status: status || undefined,
    assignedToUserId: assignedToUserId || undefined,
    vanId: vanId || undefined,
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
    vanId,
    setVanId,
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

// Phase 3 — bulk entry point into the same plan()+moveDeliveryItems() flow as
// the single Plan dialog. Also invalidates the daily-sheets list since the
// underlying items just moved onto (possibly new) destination sheet(s).
export const useBulkScheduleDeliveryIssues = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      issueIds: string[];
      destinationVanId: string;
      destinationDate: string;
      notes?: string;
    }) => deliveryIssuesApi.bulkSchedule(data),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['delivery-issues'] });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      const count = res?.data?.issuesUpdated ?? res?.data?.movedCount;
      toast.success(count ? `${count} issue(s) scheduled` : 'Issues scheduled');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to bulk schedule'),
  });
};

// Phase 4 — loops the existing single resolve() server-side; reports partial
// success (some ids can fail independently, e.g. already resolved by someone else).
export const useBulkResolveDeliveryIssues = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { ids: string[]; resolution: string; notes?: string }) =>
      deliveryIssuesApi.bulkResolve(data),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['delivery-issues'] });
      const succeeded = res?.data?.succeeded ?? 0;
      const failed = res?.data?.failed ?? 0;
      if (failed > 0) {
        toast.error(`${succeeded} resolved, ${failed} failed — some issues may already be resolved`);
      } else {
        toast.success(`${succeeded} issue(s) resolved`);
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to bulk resolve'),
  });
};
