import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { vendorsApi, type VendorQuery } from '../api/vendors.api';
import { queryKeys } from '../../../lib/query-keys';

export const useVendors = (params: VendorQuery = {}) => {
  return useQuery({
    queryKey: queryKeys.vendors.all(params),
    queryFn: () => vendorsApi.getAll(params).then((r) => r.data),
  });
};

export const useCreateVendor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => vendorsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      toast.success('Vendor created successfully');
    },
    onError: () => toast.error('Failed to create vendor'),
  });
};

export const useUpdateVendor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      vendorsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      toast.success('Vendor updated successfully');
    },
    onError: () => toast.error('Failed to update vendor'),
  });
};

export const useDeleteVendor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => vendorsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      toast.success('Vendor deleted');
    },
    onError: () => toast.error('Failed to delete vendor'),
  });
};
