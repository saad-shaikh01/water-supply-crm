import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import type { SheetDetail, CustomerDeliveryHistoryItem, CustomerFinancialSummary, DeliveryItemNote } from '@water-supply-crm/types';
import {
  dailySheetsApi,
  type SheetQuery,
  type SheetImportPreviewResponse,
  type ImportRowConfirmDto,
  type GlobalImportPreviewResponse,
  type GlobalImportGroupDto,
} from '../api/daily-sheets.api';
import { customersApi } from '../../customers/api/customers.api';
import { queryKeys } from '../../../lib/query-keys';
import { useAuthStore } from '../../../store/auth.store';

export const useDailySheets = () => {
  const user = useAuthStore((s) => s.user);
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));
  const [routeId] = useQueryState('routeId', parseAsString.withDefault(''));
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [driverId] = useQueryState('driverId', parseAsString.withDefault(''));
  const [isClosed] = useQueryState('isClosed', parseAsString.withDefault(''));

  const params: SheetQuery = {
    page,
    limit,
    dateFrom: from || undefined,
    dateTo: to || undefined,
    routeId: routeId || undefined,
    vanId: vanId || undefined,
    isClosed: isClosed === 'true' ? true : isClosed === 'false' ? false : undefined,
    // DRIVER only sees their own sheets
    driverId: user?.role === 'DRIVER' ? user.id : (driverId || undefined),
  };

  return {
    ...useQuery({
      queryKey: queryKeys.sheets.all(params),
      queryFn: () => dailySheetsApi.getAll(params).then((r) => r.data),
    }),
    page,
    setPage,
    limit,
    setLimit,
    from,
    to,
    routeId,
    vanId,
    driverId,
    isClosed,
  };
};

export const useDailySheet = (id: string) => {
  return useQuery({
    queryKey: queryKeys.sheets.one(id),
    queryFn: (): Promise<SheetDetail> => dailySheetsApi.getOne(id).then((r) => r.data),
    enabled: !!id,
  });
};

export const useGenerateSheet = () => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 2,
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
    retry: 2,
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
    retry: 2,
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
    retry: 2,
    mutationFn: ({ itemId, data }: { itemId: string; data: Record<string, unknown> & { forceResubmit?: boolean } }) =>
      dailySheetsApi.updateDeliveryItem(itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-issues'] });
      toast.success('Delivery recorded');
    },
    onError: () => toast.error('Failed to record delivery'),
  });
};

export const useAddAdhocItem = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { customerId: string; productId: string; filledDropped: number; emptyReceived: number; cashCollected: number; priceOverride?: number }) =>
      dailySheetsApi.addAdhocItem(sheetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Ad-hoc delivery recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add delivery'),
  });
};

export const useAddCorrectionItem = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { customerId: string; productId: string; filledDropped: number; emptyReceived: number; cashCollected: number; priceOverride?: number; correctionNote: string }) =>
      dailySheetsApi.addCorrectionItem(sheetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Correction entry recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add correction'),
  });
};

export const useCloseSheet = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 2,
    mutationFn: () => dailySheetsApi.close(sheetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Sheet closed successfully');
    },
    onError: () => toast.error('Failed to close sheet'),
  });
};

export const useSwapAssignment = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 2,
    mutationFn: (data: Record<string, unknown>) => dailySheetsApi.swapAssignment(sheetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Assignment updated');
    },
    onError: () => toast.error('Failed to update assignment'),
  });
};

export const useCreateLoad = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 2,
    mutationFn: (data: Record<string, unknown>) => dailySheetsApi.createLoad(sheetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Trip started — load-out recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to start trip'),
  });
};

export const useCheckinLoad = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 2,
    mutationFn: ({ loadId, data }: { loadId: string; data: Record<string, unknown> }) =>
      dailySheetsApi.checkinLoad(sheetId, loadId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Trip checked in');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to check in'),
  });
};

export const useUpdateCustomerLocation = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 2,
    mutationFn: async ({ customerId, latitude, longitude, address }: { customerId: string; latitude: number; longitude: number; address?: string }) => {
      await customersApi.updateLocation(customerId, latitude, longitude);
      if (address) await customersApi.update(customerId, { address });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
    },
    onError: () => toast.error('Failed to save location'),
  });
};

export const useCustomerDeliveryHistory = (customerId: string, enabled: boolean) => {
  return useQuery({
    queryKey: ['customer-delivery-history', customerId],
    queryFn: (): Promise<CustomerDeliveryHistoryItem[]> =>
      dailySheetsApi.getCustomerDeliveryHistory(customerId).then((r) => r.data),
    enabled: enabled && !!customerId,
    staleTime: 1000 * 60 * 5,
  });
};

export const useCustomerFinancialSummary = (
  customerId: string,
  sheetId: string,
  enabled: boolean,
) => {
  return useQuery({
    queryKey: ['customer-financial-summary', customerId, sheetId],
    queryFn: (): Promise<CustomerFinancialSummary> =>
      dailySheetsApi.getCustomerFinancialSummary(customerId, sheetId).then((r) => r.data),
    enabled: enabled && !!customerId && !!sheetId,
    staleTime: 1000 * 60 * 5,
  });
};

export const useUnlockDeliveryEdit = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, windowMinutes }: { itemId: string; windowMinutes?: number }) =>
      dailySheetsApi.unlockDeliveryEdit(itemId, windowMinutes ? { windowMinutes } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Edit unlocked for 30 minutes');
    },
    onError: () => toast.error('Failed to unlock edit'),
  });
};

export const useRequestDeliveryEdit = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => dailySheetsApi.requestDeliveryEdit(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Edit request sent to admin');
    },
    onError: () => toast.error('Failed to send edit request'),
  });
};

export const useAddTextNote = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, text }: { itemId: string; text: string }) =>
      dailySheetsApi.addTextNote(itemId, { type: 'TEXT', text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Note added');
    },
    onError: () => toast.error('Failed to add note'),
  });
};

export const useAddVoiceNote = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, formData, duration }: { itemId: string; formData: FormData; duration?: number }) =>
      dailySheetsApi.addVoiceNote(itemId, formData, duration),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Voice note uploaded');
    },
    onError: () => toast.error('Failed to upload voice note'),
  });
};

export const useAcknowledgeNote = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => dailySheetsApi.acknowledgeNote(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
    },
    onError: () => toast.error('Failed to acknowledge note'),
  });
};

export const useNoteAudioUrl = (noteId: string, enabled: boolean) => {
  return useQuery({
    queryKey: ['note-audio-url', noteId],
    queryFn: (): Promise<{ signedUrl: string }> =>
      dailySheetsApi.getNoteAudioUrl(noteId).then((r) => r.data),
    enabled: enabled && !!noteId,
    staleTime: 1000 * 60 * 10, // 10 min (signed URL valid for 15 min)
    gcTime: 1000 * 60 * 12,
  });
};

export const usePreviewBulkImport = (sheetId: string) => {
  return useMutation({
    mutationFn: (file: File): Promise<SheetImportPreviewResponse> =>
      dailySheetsApi.previewBulkImport(sheetId, file).then((r) => r.data),
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Failed to parse file. Check the format and try again.'),
  });
};

export const useConfirmBulkImport = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rows: ImportRowConfirmDto[]) =>
      dailySheetsApi.confirmBulkImport(sheetId, rows).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Deliveries imported successfully');
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Import failed. Please try again.'),
  });
};

export const usePreviewGlobalBulkImport = () => {
  return useMutation({
    mutationFn: (file: File): Promise<GlobalImportPreviewResponse> =>
      dailySheetsApi.previewGlobalBulkImport(file).then((r) => r.data),
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Failed to parse file. Check the format and try again.'),
  });
};

export const useConfirmGlobalBulkImport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groups: GlobalImportGroupDto[]) =>
      dailySheetsApi.confirmGlobalBulkImport(groups).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Global import completed');
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Global import failed. Please try again.'),
  });
};
