import { apiClient } from '@water-supply-crm/data-access';

export interface PaymentInfo {
  raastId: string | null;
  instructions: string;
}

export interface RaastQrRequest {
  amount: number;
}

export interface RaastQrResponse {
  id: string;
  checkoutUrl: string;
  qrExpiresAt: string;
  qrCodeData?: string;
}

export interface ManualPaymentRequest {
  amount: number;
  method: 'MANUAL_RAAST' | 'MANUAL_JAZZCASH' | 'MANUAL_EASYPAISA' | 'MANUAL_BANK';
  referenceNo: string;
  customerNote?: string;
  screenshot?: File;
}

export const paymentsApi = {
  getPaymentInfo: () => 
    apiClient.get<PaymentInfo>('/portal/payment-info'),

  initiateRaastQr: (data: RaastQrRequest) =>
    apiClient.post<RaastQrResponse>('/portal/payments/raast', { ...data, method: 'RAAST_QR' }),

  submitManualPayment: (data: FormData) => 
    apiClient.post('/portal/payments/manual', data, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }),

  getPaymentStatus: (id: string) => 
    apiClient.get(`/portal/payments/${id}`),

  getPaymentHistory: (params: { page?: number; limit?: number }) => 
    apiClient.get('/portal/payments', { params }),
};
