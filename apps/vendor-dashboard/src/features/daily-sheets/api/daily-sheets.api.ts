import { apiClient } from '@water-supply-crm/data-access';

export interface PreviewRowResult {
  rowIndex: number;
  itemId: string | null;
  customerName: string;
  customerCode: string;
  productName: string;
  currentDbStatus: string;
  importStatus: string;
  filledDropped: number;
  emptyReturned: number;
  cashCollected: number;
  failureReason?: string;
  errors: string[];
  warnings: string[];
}

export interface SheetImportPreviewResponse {
  sheetId: string;
  valid: PreviewRowResult[];
  invalid: PreviewRowResult[];
  summary: { total: number; valid: number; invalid: number };
}

export interface ImportRowConfirmDto {
  itemId: string;
  status: 'COMPLETED' | 'SKIPPED' | 'FAILED';
  filledDropped: number;
  emptyReturned: number;
  cashCollected: number;
  failureReason?: string;
  failureCategory?: string;
}

export interface SheetImportConfirmResponse {
  sheetId: string;
  processed: number;
  errors: Array<{ itemId: string; customerCode?: string; message: string }>;
}

export interface AdhocPreviewRow {
  rowIndex: number;
  customerId: string;
  customerCode: string;
  customerName: string;
  importStatus: string;
  filledDropped: number;
  emptyReturned: number;
  cashCollected: number;
  failureReason?: string;
  warnings: string[];
}

export interface AmbiguousPreviewRow {
  rowIndex: number;
  customerId: string;
  customerCode: string;
  customerName: string;
  importStatus: string;
  filledDropped: number;
  emptyReturned: number;
  cashCollected: number;
  failureReason?: string;
  warnings: string[];
  availableVans: Array<{ vanId: string; plateNumber: string }>;
}

export interface GlobalPreviewGroup {
  date: string;
  vanPlateNumber: string;
  sheetId: string | null;
  sheetFound: boolean;
  isClosed: boolean;
  blockReason?: string;
  valid: PreviewRowResult[];
  adhoc: AdhocPreviewRow[];
  invalid: PreviewRowResult[];
}

export interface GlobalImportPreviewResponse {
  groups: GlobalPreviewGroup[];
  ambiguous: AmbiguousPreviewRow[];
  summary: {
    totalRows: number;
    validRows: number;
    adhocRows: number;
    invalidRows: number;
    blockedGroups: number;
    ambiguousRows: number;
  };
}

export interface AdhocImportRowDto {
  customerId: string;
  sheetId: string;
  status: string;
  filledDropped: number;
  emptyReturned: number;
  cashCollected: number;
  failureReason?: string;
}

export interface GlobalImportGroupDto {
  sheetId: string;
  rows: ImportRowConfirmDto[];
  adhocRows: AdhocImportRowDto[];
}

export interface GlobalConfirmGroupResult {
  sheetId: string;
  date: string;
  vanPlateNumber: string;
  success: boolean;
  processed: number;
  error?: string;
}

export interface GlobalImportConfirmResponse {
  results: GlobalConfirmGroupResult[];
  totalProcessed: number;
  failedGroups: number;
}

export interface ExportPreviewVan {
  vanId: string;
  plateNumber: string;
  completed: number;
  pending: number;
  cancelled: number;
}

export interface ExportPreviewResponse {
  perVan: ExportPreviewVan[];
  totals: { completed: number; pending: number; cancelled: number };
}

export interface MoveDeliveryItemsData {
  itemIds: string[];
  destinationVanId: string;
  destinationDate: string;
  note?: string;
}

export interface MoveDeliveryItemsResponse {
  destinationSheetId: string;
  createdNewSheet: boolean;
  movedCount: number;
}

export interface DestinationOption {
  vanId: string;
  plateNumber: string;
  driverName: string | null;
  hasSheetForDate: boolean;
  sheetId?: string;
  isClosed: boolean;
}

export interface SheetQuery {
  page?: number;
  limit?: number;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  routeId?: string;
  vanId?: string;
  driverId?: string;
  isClosed?: boolean;
}

export const dailySheetsApi = {
  getAll: (params: SheetQuery) => apiClient.get('/daily-sheets', { params }),
  getOne: (id: string) => apiClient.get(`/daily-sheets/${id}`),
  generate: (data: Record<string, unknown>) => apiClient.post('/daily-sheets/generate', data).then((r) => r.data),
  getGenerationStatus: (jobId: string) => apiClient.get(`/daily-sheets/generation-status/${jobId}`).then((r) => r.data),
  loadOut: (id: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/${id}/load-out`, data),
  checkIn: (id: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/${id}/check-in`, data),
  close: (id: string) => apiClient.post(`/daily-sheets/${id}/close`),
  // Soft Close (Amendment R9): Driver/Salesman self-close + Staff/Admin review.
  requestClose: (id: string) => apiClient.post(`/daily-sheets/${id}/request-close`),
  approveClose: (id: string) => apiClient.post(`/daily-sheets/${id}/approve-close`),
  rejectClose: (id: string, data: { reason: string }) =>
    apiClient.post(`/daily-sheets/${id}/reject-close`, data),
  getReconciliationPreview: (id: string) =>
    apiClient.get(`/daily-sheets/${id}/reconciliation-preview`).then((r) => r.data),
  getItemHistory: (itemId: string) =>
    apiClient.get(`/daily-sheets/items/${itemId}/history`).then((r) => r.data),
  insertItemFromOrder: (
    id: string,
    data: { orderId: string; sequenceMode?: 'APPEND' | 'CUSTOM'; sequence?: number },
  ) => apiClient.post(`/daily-sheets/${id}/items/from-order`, data),
  addAdhocItem: (
    id: string,
    data: { customerId: string; productId: string; filledDropped: number; emptyReceived: number; cashCollected: number; priceOverride?: number },
  ) => apiClient.post(`/daily-sheets/${id}/items/adhoc`, data),
  addCorrectionItem: (
    id: string,
    data: { customerId: string; productId: string; filledDropped: number; emptyReceived: number; cashCollected: number; priceOverride?: number; correctionNote: string },
  ) => apiClient.post(`/daily-sheets/${id}/items/correction`, data),
  updateDeliveryItem: (itemId: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/items/${itemId}`, data),
  swapAssignment: (id: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/${id}/swap-assignment`, data),
  confirmCrew: (id: string) =>
    apiClient.post(`/daily-sheets/${id}/confirm-crew`),
  moveDeliveryItems: (data: MoveDeliveryItemsData) =>
    apiClient.patch<MoveDeliveryItemsResponse>('/daily-sheets/items/move', data).then((r) => r.data),
  getDestinationOptions: (date: string) =>
    apiClient.get<DestinationOption[]>('/daily-sheets/destination-options', { params: { date } }).then((r) => r.data),
  exportPdf: (id: string) =>
    apiClient.get(`/daily-sheets/${id}/export`, { responseType: 'blob' }),
  exportInvoice: (id: string) =>
    apiClient.get(`/daily-sheets/${id}/invoice`, { responseType: 'blob' }),
  // Load trips
  createLoad: (id: string, data: Record<string, unknown>) =>
    apiClient.post(`/daily-sheets/${id}/loads`, data),
  checkinLoad: (id: string, loadId: string, data: Record<string, unknown>) =>
    apiClient.patch(`/daily-sheets/${id}/loads/${loadId}/checkin`, data),
  getLoads: (id: string) =>
    apiClient.get(`/daily-sheets/${id}/loads`),
  requestTripEdit: (id: string, loadId: string) =>
    apiClient.patch(`/daily-sheets/${id}/loads/${loadId}/request-edit`, {}),
  unlockTripEdit: (id: string, loadId: string, data?: { windowMinutes?: number }) =>
    apiClient.patch(`/daily-sheets/${id}/loads/${loadId}/unlock-edit`, data ?? {}),
  getCustomerDeliveryHistory: (customerId: string, limit = 6) =>
    apiClient.get(`/daily-sheets/customers/${customerId}/delivery-history`, { params: { limit } }),
  getCustomerFinancialSummary: (customerId: string, sheetId: string) =>
    apiClient.get(`/daily-sheets/customers/${customerId}/financial-summary`, { params: { sheetId } }),
  unlockDeliveryEdit: (itemId: string, data?: { windowMinutes?: number }) =>
    apiClient.patch(`/daily-sheets/items/${itemId}/unlock-edit`, data ?? {}),
  requestDeliveryEdit: (itemId: string) =>
    apiClient.patch(`/daily-sheets/items/${itemId}/request-edit`, {}),
  // Delivery failure photo
  uploadDeliveryPhoto: (file: File): Promise<{ key: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient
      .post<{ key: string }>('/daily-sheets/items/upload-photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
  getDeliveryPhotoUrl: (itemId: string) =>
    apiClient.get<{ signedUrl: string }>(`/daily-sheets/items/${itemId}/photo-url`),
  downloadReceipt: (itemId: string) =>
    apiClient.get(`/daily-sheets/items/${itemId}/receipt`, { responseType: 'blob' }),
  // Bulk import
  downloadBulkImportTemplate: (sheetId: string) =>
    apiClient.get('/daily-sheets/bulk-import/template', {
      params: { sheetId },
      responseType: 'blob',
    }),
  previewBulkImport: (sheetId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post<SheetImportPreviewResponse>(
      '/daily-sheets/bulk-import/preview',
      formData,
      { params: { sheetId }, headers: { 'Content-Type': undefined } },
    );
  },
  confirmBulkImport: (sheetId: string, rows: ImportRowConfirmDto[]) =>
    apiClient.post<SheetImportConfirmResponse>(
      '/daily-sheets/bulk-import/confirm',
      { rows },
      { params: { sheetId } },
    ),
  // Global bulk import
  downloadGlobalBulkImportTemplate: () =>
    apiClient.get('/daily-sheets/bulk-import/global-template', {
      responseType: 'blob',
    }),
  previewGlobalBulkImport: (file: File, date: string) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post<GlobalImportPreviewResponse>(
      `/daily-sheets/bulk-import/global-preview?date=${encodeURIComponent(date)}`,
      formData,
      { headers: { 'Content-Type': undefined } },
    );
  },
  confirmGlobalBulkImport: (groups: GlobalImportGroupDto[]) =>
    apiClient.post<GlobalImportConfirmResponse>(
      '/daily-sheets/bulk-import/global-confirm',
      { groups },
    ),
  // CSV export
  getExportPreview: (data: { date: string; vanIds?: string[] }) =>
    apiClient.post('/daily-sheets/export/preview', data).then((r) => r.data),
  downloadExportCsv: (date: string, vanIds?: string[]) =>
    apiClient.get('/daily-sheets/export/csv', {
      params: { date, vanIds: vanIds?.length ? vanIds.join(',') : undefined },
      responseType: 'blob',
    }),
};
