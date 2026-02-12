import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { routesApi } from '../api/routes.api';
import { queryKeys } from '../../../lib/query-keys';

export const useRoutes = () => {
  return useQuery({
    queryKey: queryKeys.routes.all,
    queryFn: () => routesApi.getAll().then((r) => r.data),
  });
};

export const useCreateRoute = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => routesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.routes.all });
      toast.success('Route created');
    },
    onError: () => toast.error('Failed to create route'),
  });
};

export const useUpdateRoute = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      routesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.routes.all });
      toast.success('Route updated');
    },
    onError: () => toast.error('Failed to update route'),
  });
};

export const useDeleteRoute = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => routesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.routes.all });
      toast.success('Route deleted');
    },
    onError: () => toast.error('Failed to delete route'),
  });
};
