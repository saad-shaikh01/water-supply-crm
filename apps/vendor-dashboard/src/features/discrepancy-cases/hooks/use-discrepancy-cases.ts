import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  discrepancyCasesApi,
  type DiscrepancyCaseQuery,
  type ResolveDiscrepancyDto,
} from '../api/discrepancy-cases.api';

// ── Query keys ─────────────────────────────────────────────────────────────
const DISCREPANCY_CASES_KEY = 'discrepancy-cases';

// ── List hook ──────────────────────────────────────────────────────────────
export const useDiscrepancyCases = (query: DiscrepancyCaseQuery) =>
  useQuery({
    queryKey: [DISCREPANCY_CASES_KEY, query],
    queryFn: () => discrepancyCasesApi.list(query).then((r) => r.data),
  });

// ── Single case hook ───────────────────────────────────────────────────────
export const useDiscrepancyCase = (id: string) =>
  useQuery({
    queryKey: [DISCREPANCY_CASES_KEY, id],
    queryFn: () => discrepancyCasesApi.getOne(id).then((r) => r.data),
    enabled: !!id,
  });

// ── Resolve mutation (covers all three resolution types — the DTO
// discriminates via resolutionType) ─────────────────────────────────────────
export const useResolveDiscrepancyCase = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: ResolveDiscrepancyDto }) =>
      discrepancyCasesApi.resolve(id, dto).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [DISCREPANCY_CASES_KEY] });
      queryClient.invalidateQueries({ queryKey: [DISCREPANCY_CASES_KEY, data.id] });
    },
    onError: (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        toast.error('This case was modified by another user — please refresh.');
      } else {
        toast.error('Failed to resolve discrepancy case');
      }
    },
  });
};

// ── Audit log hook ─────────────────────────────────────────────────────────
export const useDiscrepancyAuditLog = (id: string) =>
  useQuery({
    queryKey: [DISCREPANCY_CASES_KEY, id, 'audit-log'],
    queryFn: () => discrepancyCasesApi.getAuditLog(id).then((r) => r.data),
    enabled: !!id,
  });
