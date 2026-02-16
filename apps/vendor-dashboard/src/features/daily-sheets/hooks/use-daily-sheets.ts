import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger } from 'nuqs';
import { toast } from 'sonner';
import { dailySheetsApi, type SheetQuery } from '../api/daily-sheets.api';
import { queryKeys } from '../../../lib/query-keys';
import { useAuthStore } from '../../../store/auth.store';

export const useDailySheets = () => {
  const user = useAuthStore((s) => s.user);
  const [page] = useQueryState('page', parseAsInteger.withDefault(1));
  const [date] = useQueryState('date', { defaultValue: '' });
  const [routeId] = useQueryState('routeId', { defaultValue: '' });
  const [status] = useQueryState('status', { defaultValue: '' });

  const params: SheetQuery = {
    page,
    limit: 20,
    date: date || undefined,
    routeId: routeId || undefined,
    status: status || undefined,
    // DRIVER only sees their own sheets
    driverId: user?.role === 'DRIVER' ? user.id : undefined,
  };

  return {
    ...useQuery({
      queryKey: queryKeys.sheets.all(params),
      queryFn: () => dailySheetsApi.getAll(params).then((r) => r.data),
    }),
    page,
    date,
    routeId,
    status,
  };
};

export const useDailySheet = (id: string) => {
  return useQuery({
    queryKey: queryKeys.sheets.one(id),
    queryFn: () => dailySheetsApi.getOne(id).then((r) => r.data),
    enabled: !!id,
  });
};

export const useGenerateSheet = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => dailySheetsApi.generate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Sheet generation started...');
    },
    onError: () => toast.error('Failed to start sheet generation'),
  });
};

export const useGenerationStatus = (jobId: string) => {
  return useQuery({
    queryKey: ['sheet-generation-status', jobId],
    queryFn: () => dailySheetsApi.getGenerationStatus(jobId),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data as any;
      if (data?.status === 'completed' || data?.status === 'failed') {
        return false;
      }
      return 1000; // Poll every second
    },
  });
};

export const useLoadOut = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => dailySheetsApi.loadOut(sheetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Load-out recorded');
    },
    onError: () => toast.error('Failed to record load-out'),
  });
};

export const useCheckIn = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => dailySheetsApi.checkIn(sheetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Check-in recorded');
    },
    onError: () => toast.error('Failed to record check-in'),
  });
};

export const useUpdateDeliveryItem = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: Record<string, unknown> }) => 
      dailySheetsApi.updateDeliveryItem(itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Delivery recorded');
    },
    onError: () => toast.error('Failed to record delivery'),
  });
};

export const useCloseSheet = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => dailySheetsApi.close(sheetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Sheet closed successfully');
    },
    onError: () => toast.error('Failed to close sheet'),
  });
};
