import { apiClient } from '@water-supply-crm/data-access';
import type { ReceiptPrintBranding, ReceiptPrintData } from '@water-supply-crm/types';

export const receiptPrintingApi = {
  getData: (itemId: string) =>
    apiClient.get<ReceiptPrintData>(`/daily-sheets/items/${itemId}/receipt-data`).then((r) => r.data),
  getBranding: () =>
    apiClient.get<ReceiptPrintBranding>('/daily-sheets/receipt-print/branding').then((r) => r.data),
};
