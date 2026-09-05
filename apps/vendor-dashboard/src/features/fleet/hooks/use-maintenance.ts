import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fleetApi, type CreateServiceRecordData } from '../api/fleet.api';
import { queryKeys } from '../../../lib/query-keys';

export const useVehicleMaintenanceStatus = (vehicleId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.fleet.maintenanceStatus(vehicleId ?? ''),
    queryFn: () => fleetApi.getMaintenanceStatusForVehicle(vehicleId as string),
    enabled: !!vehicleId,
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
      vehicleId,
      data,
    }: {
      id: string;
      vehicleId: string;
      data: { intervalKm?: number | null; intervalDays?: number | null; isActive?: boolean };
    }) => fleetApi.updateMaintenanceRule(id, data),
    onSuccess: (_result, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.maintenanceStatus(vehicleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.maintenanceFleetStatus() });
      toast.success('Maintenance interval updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update maintenance interval'),
  });
};

export const useServiceRecords = (params?: { page?: number; limit?: number; vehicleId?: string }) =>
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
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.maintenanceStatus(variables.vehicleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.maintenanceFleetStatus() });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.overview() });
      toast.success('Service record added');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add service record'),
  });
};

// Single-record fetch — used by the Expense Center detail drawer (Phase 2b)
// to pre-fill ServiceRecordFormDialog's edit mode by `sourceRecordId`.
export const useServiceRecord = (id: string | undefined) =>
  useQuery({
    queryKey: queryKeys.fleet.serviceRecord(id ?? ''),
    queryFn: () => fleetApi.getServiceRecord(id as string),
    enabled: !!id,
  });

export const useUpdateServiceRecord = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateServiceRecordData> }) => fleetApi.updateServiceRecord(id, data),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.serviceRecords() });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.serviceRecord(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.maintenanceFleetStatus() });
      // The service record also projects into Expense Center's Timeline/
      // Summary — see use-expenses.ts's useUpdateExpense identical note.
      queryClient.invalidateQueries({ queryKey: ['expense-center'] });
      toast.success('Service record updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update service record'),
  });
};

export const useDeleteServiceRecord = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fleetApi.removeServiceRecord(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.serviceRecords() });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.maintenanceFleetStatus() });
      queryClient.invalidateQueries({ queryKey: ['expense-center'] });
      toast.success('Service record deleted');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to delete service record'),
  });
};
