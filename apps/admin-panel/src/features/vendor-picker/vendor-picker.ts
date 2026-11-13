'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

export interface VendorOpt {
  id: string;
  name: string;
}

/** Server-side vendor search used by every picker (subscriptions, invoices, announcements). */
export const useVendorSearch = (search: string, enabled = true) =>
  useQuery({
    queryKey: ['vendors', 'picker', search],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<VendorOpt[]> => {
      const res = await apiClient.get<{ data: VendorOpt[] }>('/vendors', { params: { limit: 50, ...(search ? { search } : {}) } });
      return (res.data.data ?? []).map((v) => ({ id: v.id, name: v.name }));
    },
  });
