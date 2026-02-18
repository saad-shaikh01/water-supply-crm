import { useQuery } from '@tanstack/react-query';
import { deliveriesApi } from '../api/deliveries.api';
import { toast } from 'sonner';

export const useDeliveries = (params: { page?: number; limit?: number }) =>
  useQuery({
    queryKey: ['portal-deliveries', params],
    queryFn: () => deliveriesApi.getAll(params).then((r) => r.data),
  });

export const useDeliverySchedule = (params?: { from?: string; to?: string }) =>
  useQuery({
    queryKey: ['portal-schedule', params],
    queryFn: () => deliveriesApi.getSchedule(params).then((r) => r.data),
  });

export const downloadStatement = async (month?: string) => {
  try {
    const res = await deliveriesApi.getStatement({ month });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `statement-${month ?? 'latest'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    toast.error('Failed to download statement');
  }
};
