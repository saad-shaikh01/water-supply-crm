import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { vansApi } from '../api/vans.api';
import { queryKeys } from '../../../lib/query-keys';

export const useVans = () => {
  return useQuery({
    queryKey: queryKeys.vans.all,
    queryFn: () => vansApi.getAll().then((r) => r.data),
  });
};

export const useCreateVan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => vansApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vans.all });
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
      queryClient.invalidateQueries({ queryKey: queryKeys.vans.all });
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
      queryClient.invalidateQueries({ queryKey: queryKeys.vans.all });
      toast.success('Van deleted');
    },
    onError: () => toast.error('Failed to delete van'),
  });
};
