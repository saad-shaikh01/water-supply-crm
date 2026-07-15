import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CollectionPolicy, CashCollectionPolicy } from '@water-supply-crm/types';
import { collectionPolicyApi, cashCollectionPolicyApi, type CashCollectionPolicyImpactParams } from '../api/collection-policy.api';

const QUERY_KEY = ['collection-policy'];

export const useCollectionPolicy = () =>
  useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => collectionPolicyApi.get().then((r) => r.data),
  });

export const useUpdateCollectionPolicy = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CollectionPolicy) => collectionPolicyApi.update(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success('Collection policy updated');
    },
    onError: () => toast.error('Failed to update collection policy'),
  });
};

const CASH_QUERY_KEY = ['collection-policy', 'cash'];

export const useCashCollectionPolicy = () =>
  useQuery({
    queryKey: CASH_QUERY_KEY,
    queryFn: () => cashCollectionPolicyApi.get().then((r) => r.data),
  });

export const useUpdateCashCollectionPolicy = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CashCollectionPolicy) => cashCollectionPolicyApi.update(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CASH_QUERY_KEY });
      toast.success('Cash collection policy updated');
    },
    onError: () => toast.error('Failed to update cash collection policy'),
  });
};

/**
 * Live, debounced rollout-guard preview (§8.1, §21.1) — the caller is
 * responsible for debouncing `params` (see the settings form) and passing
 * `null` while the entered values are invalid/incomplete, which disables
 * the query entirely rather than firing on every keystroke.
 */
export const useCashCollectionPolicyImpact = (params: CashCollectionPolicyImpactParams | null) =>
  useQuery({
    queryKey: ['collection-policy', 'cash', 'impact', params],
    queryFn: () => cashCollectionPolicyApi.impact(params as CashCollectionPolicyImpactParams).then((r) => r.data),
    enabled: params !== null,
    staleTime: 0, // always a fresh read-only preview, never stale-served
  });
