import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { pricingApi } from '../api/pricing.api';
import type {
  BulkPricePreviewRequest,
  BulkPriceUpdateRequest,
  BulkPricePreviewResponse,
  BulkUpdateEnqueueResponse,
  BulkUpdateJobStatus,
} from '../types';

export const usePreviewBulkPricing = () =>
  useMutation<BulkPricePreviewResponse, Error, BulkPricePreviewRequest>({
    mutationFn: (data) => pricingApi.previewBulkPricing(data).then((r) => r.data),
    onError: () => toast.error('Failed to load preview'),
  });

export const useBulkUpdatePricing = () =>
  useMutation<BulkUpdateEnqueueResponse, Error, BulkPriceUpdateRequest>({
    mutationFn: (data) => pricingApi.bulkUpdatePricing(data).then((r) => r.data),
    // Success/failure is surfaced via the job-status polling UI, not a toast here.
    onError: () => toast.error('Failed to start bulk update'),
  });

export const useBulkUpdateJobStatus = (jobId: string | null) => {
  const queryClient = useQueryClient();
  return useQuery<BulkUpdateJobStatus, Error>({
    queryKey: ['pricing', 'bulk-update-status', jobId],
    queryFn: () => pricingApi.getBulkUpdateStatus(jobId as string).then((r) => r.data),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      // Stop polling once the job has finished.
      if (state === 'completed' || state === 'failed') {
        if (state === 'completed') {
          queryClient.invalidateQueries({ queryKey: ['customers'] });
        }
        return false;
      }
      return 2000;
    },
  });
};
