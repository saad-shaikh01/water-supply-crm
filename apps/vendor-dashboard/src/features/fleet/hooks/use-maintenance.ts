import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fleetApi, type CreateServiceRecordData } from '../api/fleet.api';
import { queryKeys } from '../../../lib/query-keys';

export const useVehicleMaintenanceStatus = (vanId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.fleet.maintenanceStatus(vanId ?? ''),
    queryFn: () => fleetApi.getMaintenanceStatusForVan(vanId as string),
    enabled: !!vanId,
  });

export const useFleetMaintenanceStatus = () =>
  useQuery({
    queryKey: queryKeys.fleet.maintenanceFleetStatus(),
    queryFn: () => fleetApi.getFleetMaintenanceStatus(),
    staleTime: 5 * 60 * 1000,
  });

export const useUpdateMaintenanceRule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      vanId,
      data,
    }: {
      id: string;
      vanId: string;
      data: { intervalKm?: number | null; intervalDays?: number | null; isActive?: boolean };
    }) => fleetApi.updateMaintenanceRule(id, data),
    onSuccess: (_result, { vanId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.maintenanceStatus(vanId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.maintenanceFleetStatus() });
      toast.success('Maintenance interval updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update maintenance interval'),
  });
};

export const useServiceRecords = (params?: { page?: number; limit?: number; vanId?: string }) =>
  useQuery({
    queryKey: queryKeys.fleet.serviceRecords(params),
    queryFn: () => fleetApi.getServiceRecords(params),
  });

export const useCreateServiceRecord = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateServiceRecordData) => fleetApi.createServiceRecord(data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.serviceRecords() });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.maintenanceStatus(variables.vanId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.maintenanceFleetStatus() });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.overview() });
      toast.success('Service record added');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add service record'),
  });
};
