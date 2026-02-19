import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger } from 'nuqs';
import { toast } from 'sonner';
import { usersApi } from '../api/users.api';
import { queryKeys } from '../../../lib/query-keys';

export const useUsers = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));

  const params = { page, limit };

  return {
    ...useQuery({
      queryKey: queryKeys.users.all(params),
      queryFn: () => usersApi.getAll(params).then((r) => r.data),
    }),
    page,
    setPage,
    limit,
    setLimit,
  };
};

export const useCreateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => usersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all() });
      toast.success('User created');
    },
    onError: () => toast.error('Failed to create user'),
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      usersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all() });
      toast.success('User updated');
    },
    onError: () => toast.error('Failed to update user'),
  });
};

export const useDeleteUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all() });
      toast.success('User deleted');
    },
    onError: () => toast.error('Failed to delete user'),
  });
};

export const useDeactivateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all() });
      toast.success('User deactivated');
    },
    onError: () => toast.error('Failed to deactivate user'),
  });
};

export const useReactivateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => usersApi.reactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all() });
      toast.success('User reactivated');
    },
    onError: () => toast.error('Failed to reactivate user'),
  });
};

export const useChangePassword = () => {
  return useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      usersApi.changePassword(data),
    onSuccess: () => toast.success('Password changed successfully'),
    onError: () => toast.error('Failed to change password. Check your current password.'),
  });
};
