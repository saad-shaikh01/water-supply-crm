import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fleetApi, type CreateFuelLogData } from '../api/fleet.api';
import { queryKeys } from '../../../lib/query-keys';

export const useFuelLogs = (params?: { page?: number; limit?: number; vehicleId?: string; dateFrom?: string; dateTo?: string }) =>
  useQuery({
    queryKey: queryKeys.fleet.fuelLogs(params),
    queryFn: () => fleetApi.getFuelLogs(params),
  });

export const useCreateFuelLog = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateFuelLogData) => fleetApi.createFuelLog(data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.fuelLogs() });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.overview() });
      // A fuel fill logged from a Daily Sheet also spawns a linked Expense on
      // that sheet — invalidate the sheet's own query too (same pattern as
      // useCreateSheetExpense) so its Trip Expenses stat + list stay in sync.
      if (variables.dailySheetId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(variables.dailySheetId) });
      }
      toast.success('Fuel fill recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record fuel fill'),
  });
};

export const useUpdateFuelLog = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateFuelLogData> }) => fleetApi.updateFuelLog(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.fuelLogs() });
      toast.success('Fuel log updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update fuel log'),
  });
};

export const useRemoveFuelLog = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fleetApi.removeFuelLog(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.fuelLogs() });
      toast.success('Fuel log deleted');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to delete fuel log'),
  });
};
