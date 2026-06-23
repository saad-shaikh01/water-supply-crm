import { apiClient } from '@water-supply-crm/data-access';
import type { DeliveryItemNote } from '@water-supply-crm/types';

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

export interface GlobalPreviewGroup {
  date: string;
  vanPlateNumber: string;
  sheetId: string | null;
  sheetFound: boolean;
  isClosed: boolean;
  blockReason?: string;
  valid: PreviewRowResult[];
  invalid: PreviewRowResult[];
}

export interface GlobalImportPreviewResponse {
  groups: GlobalPreviewGroup[];
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    blockedGroups: number;
  };
}

export interface GlobalImportGroupDto {
  sheetId: string;
  rows: ImportRowConfirmDto[];
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
  getReconciliationPreview: (id: string) =>
    apiClient.get(`/daily-sheets/${id}/reconciliation-preview`).then((r) => r.data),
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
  getCustomerDeliveryHistory: (customerId: string, limit = 6) =>
    apiClient.get(`/daily-sheets/customers/${customerId}/delivery-history`, { params: { limit } }),
  getCustomerFinancialSummary: (customerId: string, sheetId: string) =>
    apiClient.get(`/daily-sheets/customers/${customerId}/financial-summary`, { params: { sheetId } }),
  unlockDeliveryEdit: (itemId: string, data?: { windowMinutes?: number }) =>
    apiClient.patch(`/daily-sheets/items/${itemId}/unlock-edit`, data ?? {}),
  requestDeliveryEdit: (itemId: string) =>
    apiClient.patch(`/daily-sheets/items/${itemId}/request-edit`, {}),
  // Notes
  getItemNotes: (itemId: string) =>
    apiClient.get<DeliveryItemNote[]>(`/daily-sheets/items/${itemId}/notes`),
  addTextNote: (itemId: string, data: { type: 'TEXT'; text: string }) =>
    apiClient.post<DeliveryItemNote>(`/daily-sheets/items/${itemId}/notes`, data),
  addVoiceNote: (itemId: string, formData: FormData, duration?: number) =>
    apiClient.post<DeliveryItemNote>(
      `/daily-sheets/items/${itemId}/notes/voice${duration != null ? `?duration=${duration}` : ''}`,
      formData,
      // Unset the instance-level 'application/json' default so the browser sets
      // multipart/form-data with the correct boundary automatically.
      { headers: { 'Content-Type': undefined } },
    ),
  acknowledgeNote: (noteId: string) =>
    apiClient.patch<DeliveryItemNote>(`/daily-sheets/items/notes/${noteId}/acknowledge`, {}),
  getNoteAudioUrl: (noteId: string) =>
    apiClient.get<{ signedUrl: string }>(`/daily-sheets/items/notes/${noteId}/audio`),
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
  previewGlobalBulkImport: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post<GlobalImportPreviewResponse>(
      '/daily-sheets/bulk-import/global-preview',
      formData,
      { headers: { 'Content-Type': undefined } },
    );
  },
  confirmGlobalBulkImport: (groups: GlobalImportGroupDto[]) =>
    apiClient.post<GlobalImportConfirmResponse>(
      '/daily-sheets/bulk-import/global-confirm',
      { groups },
    ),
};
