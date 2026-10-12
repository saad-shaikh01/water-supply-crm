import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { customerGroupsApi } from '../api/customer-groups.api';

const SETTINGS_KEY = ['customer-groups', 'settings'] as const;
const LIST_KEY = ['customer-groups', 'list'] as const;

/** Pull the server's message out of an axios error. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function messageOf(e: any, fallback: string): string {
  const m = e?.response?.data?.message;
  if (Array.isArray(m)) return m.slice(0, 3).join(' · ');
  return typeof m === 'string' && m ? m : fallback;
}

/** Whether the signed-in vendor has customer grouping turned on. Everything group-related keys off this. */
export const useGroupingEnabled = () => {
  const { data, isLoading } = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => customerGroupsApi.getSettings().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  return { enabled: data?.enabled ?? false, isLoading };
};

export const useSetGroupingEnabled = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => customerGroupsApi.setSettings(enabled).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['customer-groups'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success(res.enabled ? 'Customer grouping enabled' : 'Customer grouping disabled (your groups are kept)');
    },
    onError: (e) => toast.error(messageOf(e, 'Could not update the grouping setting')),
  });
};

export const useCustomerGroups = (enabled = true, includeDeleted = false) =>
  useQuery({
    queryKey: [...LIST_KEY, { includeDeleted }],
    queryFn: () => customerGroupsApi.list(includeDeleted).then((r) => r.data),
    enabled,
    staleTime: 60 * 1000,
  });

export const useCreateCustomerGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; parentId?: string }) => customerGroupsApi.create(data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer-groups'] }),
    onError: (e) => toast.error(messageOf(e, 'Could not create the group')),
  });
};

export const useRenameCustomerGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => customerGroupsApi.rename(id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-groups'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Renamed');
    },
    onError: (e) => toast.error(messageOf(e, 'Could not rename')),
  });
};

export const useDeleteCustomerGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customerGroupsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-groups'] });
      toast.success('Deleted');
    },
    onError: (e) => toast.error(messageOf(e, 'Could not delete')),
  });
};

export const useBulkAssignGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { customerIds: string[]; groupId: string | null; subGroupId: string | null }) =>
      customerGroupsApi.bulkAssign(data).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer-groups'] });
      toast.success(`Updated ${res.updated} customer${res.updated === 1 ? '' : 's'}`);
    },
    onError: (e) => toast.error(messageOf(e, 'Could not assign the group')),
  });
};
