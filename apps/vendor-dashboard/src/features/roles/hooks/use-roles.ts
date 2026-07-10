import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  rolesApi,
  type CreateRoleInput,
  type UpdateRoleInput,
  type CloneRoleInput,
} from '../api/roles.api';
import { queryKeys } from '../../../lib/query-keys';
import { useInvalidatePermissions } from '../../authz/hooks/use-permissions';

export const useRoles = () =>
  useQuery({
    queryKey: queryKeys.roles.all(),
    queryFn: () => rolesApi.list().then((r) => r.data),
  });

export const useRole = (id: string | null) =>
  useQuery({
    queryKey: queryKeys.roles.one(id ?? ''),
    queryFn: () => rolesApi.findOne(id as string).then((r) => r.data),
    enabled: !!id,
  });

export const useCreateRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateRoleInput) => rolesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all() });
      toast.success('Role created');
    },
    onError: () => toast.error('Failed to create role'),
  });
};

export const useUpdateRole = () => {
  const queryClient = useQueryClient();
  const invalidatePermissions = useInvalidatePermissions();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateRoleInput }) => rolesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all() });
      invalidatePermissions();
      toast.success('Role updated');
    },
    onError: () => toast.error('Failed to update role'),
  });
};

export const useDeleteRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rolesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all() });
      toast.success('Role deleted');
    },
    onError: () => toast.error('Failed to delete role'),
  });
};

export const useCloneRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: CloneRoleInput }) => rolesApi.clone(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all() });
      toast.success('Role cloned');
    },
    onError: () => toast.error('Failed to clone role'),
  });
};

export const useResetRole = () => {
  const queryClient = useQueryClient();
  const invalidatePermissions = useInvalidatePermissions();
  return useMutation({
    mutationFn: (id: string) => rolesApi.reset(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all() });
      invalidatePermissions();
      toast.success('Role reset to preset');
    },
    onError: () => toast.error('Failed to reset role'),
  });
};
