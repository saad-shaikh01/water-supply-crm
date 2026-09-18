import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fleetApi, type CreateServiceRecordData, type CreateServiceTypeData } from '../api/fleet.api';
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

export const useServiceTypes = () =>
  useQuery({
    queryKey: queryKeys.fleet.serviceTypes(),
    queryFn: () => fleetApi.getServiceTypes(),
    staleTime: 5 * 60 * 1000,
  });

// A new/removed type changes every vehicle's maintenance list (rules are
// created lazily per vehicle / deleted with the type), so refresh those too.
const invalidateAfterServiceTypeChange = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.fleet.serviceTypes() });
  queryClient.invalidateQueries({ queryKey: queryKeys.fleet.maintenanceFleetStatus() });
};

export const useCreateServiceType = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateServiceTypeData) => fleetApi.createServiceType(data),
    onSuccess: (created) => {
      invalidateAfterServiceTypeChange(queryClient);
      toast.success(`Service type "${created.label}" added`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add service type'),
  });
};

export const useRenameServiceType = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) => fleetApi.renameServiceType(id, label),
    onSuccess: () => {
      invalidateAfterServiceTypeChange(queryClient);
      // Labels appear on maintenance lists and (via the re-described Expense)
      // in Expense Center / Van Cash Ledger rows and service-record lists.
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.serviceRecords() });
      queryClient.invalidateQueries({ queryKey: ['expense-center'] });
      queryClient.invalidateQueries({ queryKey: ['van-cash-ledger'] });
      toast.success('Service type renamed');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to rename service type'),
  });
};

export const useDeleteServiceType = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fleetApi.removeServiceType(id),
    onSuccess: () => {
      invalidateAfterServiceTypeChange(queryClient);
      toast.success('Service type removed');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to remove service type'),
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
      // The spawned Expense also projects into Expense Center's Timeline and
      // the Van Cash Ledger's CASH_OUT rows — see use-fuel-logs.ts's
      // identical note.
      queryClient.invalidateQueries({ queryKey: ['expense-center'] });
      queryClient.invalidateQueries({ queryKey: ['van-cash-ledger'] });
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
      // Summary and the Van Cash Ledger's CASH_OUT rows — see
      // use-expenses.ts's useUpdateExpense identical note.
      queryClient.invalidateQueries({ queryKey: ['expense-center'] });
      queryClient.invalidateQueries({ queryKey: ['van-cash-ledger'] });
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
      queryClient.invalidateQueries({ queryKey: ['van-cash-ledger'] });
      toast.success('Service record deleted');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to delete service record'),
  });
};
