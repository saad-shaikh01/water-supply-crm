import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CollectionPolicy } from '@water-supply-crm/types';
import { collectionPolicyApi } from '../api/collection-policy.api';

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
