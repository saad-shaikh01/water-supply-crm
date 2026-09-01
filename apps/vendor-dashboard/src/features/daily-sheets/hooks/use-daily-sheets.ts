import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import type { SheetDetail, CustomerDeliveryHistoryItem, CustomerFinancialSummary } from '@water-supply-crm/types';
import {
  dailySheetsApi,
  type SheetQuery,
  type SheetImportPreviewResponse,
  type ImportRowConfirmDto,
  type GlobalImportPreviewResponse,
  type GlobalImportGroupDto,
  type ExportPreviewResponse,
  type ExportType,
  type MoveDeliveryItemsData,
  type MoveDeliveryItemsResponse,
  type DestinationOption,
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
    onError: (error: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      // Gate violations (COLLECTION_POLICY_VIOLATION, CASH_COLLECTION_POLICY_VIOLATION,
      // STOCK_EXCEEDED) already get a dedicated warning card / specific toast from the
      // caller (delivery-record-form.tsx) — skip the generic toast so the driver isn't
      // shown two messages for the same failure.
      const code = error?.response?.data?.code;
      const handledElsewhere = ['COLLECTION_POLICY_VIOLATION', 'CASH_COLLECTION_POLICY_VIOLATION', 'STOCK_EXCEEDED'];
      if (!handledElsewhere.includes(code)) {
        toast.error(error?.response?.data?.message ?? 'Failed to record delivery');
      }
    },
  });
};

export const useAddAdhocItem = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { customerId: string; productId: string; filledDropped: number; emptyReceived: number; filledReceived: number; cashCollected: number; priceOverride?: number }) =>
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
    mutationFn: (data: { customerId: string; productId: string; filledDropped: number; emptyReceived: number; filledReceived: number; cashCollected: number; priceOverride?: number; correctionNote: string }) =>
      dailySheetsApi.addCorrectionItem(sheetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Correction entry recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add correction'),
  });
};

export const useVoidDelivery = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, voidReason, voidNote }: { itemId: string; voidReason: string; voidNote?: string }) =>
      dailySheetsApi.voidDelivery(itemId, { voidReason, voidNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      queryClient.invalidateQueries({ queryKey: ['customer-financial-summary'] });
      toast.success('Delivery voided');
    },
    onError: (error: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (error?.response?.data?.code === 'VOID_WOULD_MAKE_WALLET_NEGATIVE') {
        toast.error(error.response.data.message);
        return;
      }
      toast.error(error?.response?.data?.message ?? 'Failed to void delivery');
    },
  });
};

/** Per-item edit history (AuditLog rows scoped to one DailySheetItem) — fetched lazily, only when the timeline is actually opened. */
export const useDeliveryItemHistory = (itemId: string, enabled: boolean) => {
  return useQuery({
    queryKey: ['daily-sheet-item-history', itemId],
    queryFn: (): Promise<import('@water-supply-crm/types').DeliveryItemHistoryEntry[]> =>
      dailySheetsApi.getItemHistory(itemId),
    enabled: enabled && !!itemId,
  });
};

export const useCloseSheet = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 2,
    mutationFn: (data: { actualCashHandedIn: number }) => dailySheetsApi.close(sheetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Sheet closed successfully');
    },
    onError: () => toast.error('Failed to close sheet'),
  });
};

// Soft Close (Amendment R9): Driver/Salesman self-close + Staff/Admin review.
export const useRequestCloseSheet = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 2,
    mutationFn: (data: { actualCashHandedIn: number }) => dailySheetsApi.requestClose(sheetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Sheet closed — sent to Staff/Admin for approval');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to close sheet'), // eslint-disable-line @typescript-eslint/no-explicit-any
  });
};

export const useApproveCloseSheet = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 2,
    mutationFn: () => dailySheetsApi.approveClose(sheetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Close request approved — sheet finalized');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to approve close'), // eslint-disable-line @typescript-eslint/no-explicit-any
  });
};

export const useRejectCloseSheet = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { reason: string }) => dailySheetsApi.rejectClose(sheetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Close request rejected — sheet reopened');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to reject close'), // eslint-disable-line @typescript-eslint/no-explicit-any
  });
};

export const useSwapAssignment = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 2,
    mutationFn: (data: Record<string, unknown>) => dailySheetsApi.swapAssignment(sheetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Assignment updated — crew needs re-confirmation');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update assignment'),
  });
};

export const useConfirmCrew = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 2,
    mutationFn: () => dailySheetsApi.confirmCrew(sheetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success("Today's crew confirmed");
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to confirm crew'),
  });
};

export const useDestinationOptions = (date: string, enabled = true) => {
  return useQuery({
    queryKey: ['daily-sheets', 'destination-options', date],
    queryFn: (): Promise<DestinationOption[]> => dailySheetsApi.getDestinationOptions(date),
    enabled: enabled && !!date,
  });
};

export const useMoveDeliveryItems = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: MoveDeliveryItemsData): Promise<MoveDeliveryItemsResponse> =>
      dailySheetsApi.moveDeliveryItems(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(result.destinationSheetId) });
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      const who = result.movedCount > 1 ? `${result.movedCount} customers` : 'Customer';
      toast.success(`${who} moved${result.createdNewSheet ? ' — new sheet created' : ''}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to move customer'),
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

// Trip Edit-Unlock — same shape as the delivery-item pair above.
export const useUnlockTripEdit = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ loadId, windowMinutes }: { loadId: string; windowMinutes?: number }) =>
      dailySheetsApi.unlockTripEdit(sheetId, loadId, windowMinutes ? { windowMinutes } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Edit unlocked for 30 minutes');
    },
    onError: () => toast.error('Failed to unlock edit'),
  });
};

export const useRequestTripEdit = (sheetId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (loadId: string) => dailySheetsApi.requestTripEdit(sheetId, loadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sheets.one(sheetId) });
      toast.success('Edit request sent to admin');
    },
    onError: () => toast.error('Failed to send edit request'),
  });
};

export const useDeliveryPhotoUrl = (itemId: string, enabled: boolean) => {
  return useQuery({
    queryKey: ['delivery-photo-url', itemId],
    queryFn: (): Promise<{ signedUrl: string }> =>
      dailySheetsApi.getDeliveryPhotoUrl(itemId).then((r) => r.data),
    enabled: enabled && !!itemId,
    staleTime: 1000 * 60 * 10, // 10 min (signed URL valid for 15 min)
    gcTime: 1000 * 60 * 12,
  });
};

export const useUploadDeliveryPhoto = () => {
  return useMutation({
    mutationFn: (file: File) => dailySheetsApi.uploadDeliveryPhoto(file),
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
    mutationFn: ({ file, date }: { file: File; date: string }): Promise<GlobalImportPreviewResponse> =>
      dailySheetsApi.previewGlobalBulkImport(file, date).then((r) => r.data),
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Failed to parse file. Check the format and try again.'),
  });
};

export const useExportPreview = () => {
  return useMutation({
    mutationFn: (data: { date: string; vanIds?: string[]; exportType?: ExportType }): Promise<ExportPreviewResponse> =>
      dailySheetsApi.getExportPreview(data),
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Failed to load export preview. Please try again.'),
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
