import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import { vansApi } from '../api/vans.api';
import { queryKeys } from '../../../lib/query-keys';

export const useVans = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [search] = useQueryState('search', parseAsString.withDefault(''));
  const [isActive] = useQueryState('isActive', parseAsString.withDefault(''));

  const params = {
    page,
    limit,
    search: search || undefined,
    isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
  };

  return {
    ...useQuery({
      queryKey: queryKeys.vans.all(params),
      queryFn: () => vansApi.getAll(params).then((r) => r.data),
    }),
    page,
    setPage,
    limit,
    setLimit,
    search,
    isActive,
  };
};

export const useAllVans = () => {
  return useQuery({
    queryKey: [...queryKeys.vans.all({}), 'all'],
    queryFn: () => vansApi.getAll({ limit: 100 }).then((r) => r.data),
  });
};

export const useCreateVan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => vansApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vans.all() });
      toast.success('Van created');
    },
    onError: () => toast.error('Failed to create van'),
  });
};

export const useUpdateVan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      vansApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vans.all() });
      toast.success('Van updated');
    },
    onError: () => toast.error('Failed to update van'),
  });
};

export const useDeleteVan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => vansApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vans.all() });
      toast.success('Van deleted');
    },
    onError: () => toast.error('Failed to delete van'),
  });
};

export const useDeactivateVan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => vansApi.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vans.all() });
      toast.success('Van deactivated');
    },
    onError: () => toast.error('Failed to deactivate van'),
  });
};

export const useReactivateVan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => vansApi.reactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vans.all() });
      toast.success('Van reactivated');
    },
    onError: () => toast.error('Failed to reactivate van'),
  });
};
