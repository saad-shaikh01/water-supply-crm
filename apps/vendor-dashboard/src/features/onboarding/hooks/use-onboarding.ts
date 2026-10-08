import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { onboardingApi } from '../api/onboarding.api';

const KEY = ['onboarding-readiness'];

/** `enabled` lets platform admins (who have no vendor of their own) skip the call. */
export const useReadiness = (enabled = true) =>
  useQuery({
    queryKey: KEY,
    queryFn: () => onboardingApi.readiness().then((r) => r.data),
    enabled,
    staleTime: 15_000,
    retry: false, // e.g. a role without company_profile:view simply doesn't see the card
  });

export const useGoLive = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => onboardingApi.goLive().then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
      toast.success('You are live — customer messages are now enabled');
    },
    onError: (e: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (e as any)?.response?.data?.message;
      toast.error(typeof m === 'string' ? m : 'Could not go live yet — finish the required items first');
    },
  });
};
