import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fleetApi,
  type CreateFleetAlertRecipientData,
  type UpdateFleetAlertRecipientData,
} from '../api/fleet.api';
import { queryKeys } from '../../../lib/query-keys';

export const useAlertRecipients = () =>
  useQuery({
    queryKey: queryKeys.fleet.alertRecipients(),
    queryFn: () => fleetApi.getAlertRecipients(),
    staleTime: 5 * 60 * 1000,
  });

export const useCreateAlertRecipient = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateFleetAlertRecipientData) => fleetApi.createAlertRecipient(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.alertRecipients() });
      toast.success(`${created.name} added to WhatsApp alerts`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add alert recipient'),
  });
};

export const useUpdateAlertRecipient = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateFleetAlertRecipientData }) =>
      fleetApi.updateAlertRecipient(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.alertRecipients() });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update alert recipient'),
  });
};

export const useDeleteAlertRecipient = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fleetApi.removeAlertRecipient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.alertRecipients() });
      toast.success('Alert recipient removed');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to remove alert recipient'),
  });
};
