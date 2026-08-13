import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fleetApi, type CreateVehicleDailyCheckData } from '../api/fleet.api';
import { queryKeys } from '../../../lib/query-keys';

export const useVehicleDailyChecks = (dailySheetId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.fleet.dailyChecks(dailySheetId ?? ''),
    queryFn: () => fleetApi.getChecksForSheet(dailySheetId as string),
    enabled: !!dailySheetId,
  });

export const useCreateVehicleDailyCheck = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateVehicleDailyCheckData) => fleetApi.createDailyCheck(data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.dailyChecks(variables.dailySheetId) });
      toast.success(variables.checkType === 'START' ? 'Vehicle check recorded' : 'End-of-day check recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record vehicle check'),
  });
};

export const useOverrideCriticalCheck = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note, dailySheetId }: { id: string; note: string; dailySheetId: string }) =>
      fleetApi.overrideCriticalCheck(id, note),
    onSuccess: (_result, { dailySheetId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.dailyChecks(dailySheetId) });
      toast.success('Critical issue acknowledged — trip may proceed');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to acknowledge issue'),
  });
};
