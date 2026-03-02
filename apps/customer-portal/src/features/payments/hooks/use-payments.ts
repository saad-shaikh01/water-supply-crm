import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { paymentsApi, type RaastQrRequest } from '../api/payments.api';
import { toast } from 'sonner';

export const usePaymentInfo = (enabled = true) => 
  useQuery({
    queryKey: ['payment-info'],
    queryFn: () => paymentsApi.getPaymentInfo().then(r => r.data),
    enabled,
  });

export const useInitiateRaastQr = () => {
  return useMutation({
    mutationFn: (data: RaastQrRequest) => paymentsApi.initiateRaastQr(data).then(r => r.data),
    onError: () => toast.error('Failed to initiate Raast QR payment'),
  });
};

export const useSubmitManualPayment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: FormData) => paymentsApi.submitManualPayment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-history'] });
      queryClient.invalidateQueries({ queryKey: ['portal-balance'] });
      queryClient.invalidateQueries({ queryKey: ['portal-summary'] });
      toast.success('Payment proof submitted for review');
    },
    onError: () => toast.error('Failed to submit payment proof'),
  });
};

export const usePaymentHistory = (params: { page?: number; limit?: number }) => 
  useQuery({
    queryKey: ['payment-history', params],
    queryFn: () => paymentsApi.getPaymentHistory(params).then(r => r.data),
  });

export const usePaymentStatus = (id: string) => 
  useQuery({
    queryKey: ['payment-status', id],
    queryFn: () => paymentsApi.getPaymentStatus(id).then(r => r.data),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as any;
      if (data?.status === 'PAID' || data?.status === 'EXPIRED' || data?.status === 'REJECTED' || data?.status === 'APPROVED') {
        return false;
      }
      return 5000;
    }
  });
