import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  damageCasesApi,
  type DamageCaseQuery,
  type ChargeDto,
  type WaiveDto,
} from '../api/damage-cases.api';

// ── Query keys ─────────────────────────────────────────────────────────────
const DAMAGE_CASES_KEY = 'damage-cases';

// ── List hook ──────────────────────────────────────────────────────────────
export const useDamageCases = (query: DamageCaseQuery) =>
  useQuery({
    queryKey: [DAMAGE_CASES_KEY, query],
    queryFn: () => damageCasesApi.list(query).then((r) => r.data),
  });

// ── Single case hook ───────────────────────────────────────────────────────
export const useDamageCase = (id: string) =>
  useQuery({
    queryKey: [DAMAGE_CASES_KEY, id],
    queryFn: () => damageCasesApi.getOne(id).then((r) => r.data),
    enabled: !!id,
  });

// ── Review mutation ────────────────────────────────────────────────────────
export const useReviewCase = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      damageCasesApi.review(id, version).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [DAMAGE_CASES_KEY] });
      queryClient.invalidateQueries({ queryKey: [DAMAGE_CASES_KEY, data.id] });
      toast.success('Case marked under review');
    },
    onError: (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        toast.error('This case was modified by another user — please refresh.');
      } else {
        toast.error('Failed to update case');
      }
    },
  });
};

// ── Charge mutation ────────────────────────────────────────────────────────
export const useChargeCase = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: ChargeDto }) =>
      damageCasesApi.charge(id, dto).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [DAMAGE_CASES_KEY] });
      queryClient.invalidateQueries({ queryKey: [DAMAGE_CASES_KEY, data.id] });
    },
    onError: (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        toast.error('This case was modified by another user — please refresh.');
      } else {
        toast.error('Failed to charge customer');
      }
    },
  });
};

// ── Waive mutation ─────────────────────────────────────────────────────────
export const useWaiveCase = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: WaiveDto }) =>
      damageCasesApi.waive(id, dto).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [DAMAGE_CASES_KEY] });
      queryClient.invalidateQueries({ queryKey: [DAMAGE_CASES_KEY, data.id] });
    },
    onError: (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        toast.error('This case was modified by another user — please refresh.');
      } else {
        toast.error('Failed to waive charge');
      }
    },
  });
};

// ── Reverse mutation ───────────────────────────────────────────────────────
export const useReverseCase = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      damageCasesApi.reverse(id, version).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [DAMAGE_CASES_KEY] });
      queryClient.invalidateQueries({ queryKey: [DAMAGE_CASES_KEY, data.id] });
      toast.success('Charge reversed — money credited to customer. Bottle wallet unchanged.');
    },
    onError: (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        toast.error('This case was modified by another user — please refresh.');
      } else {
        toast.error('Failed to reverse charge');
      }
    },
  });
};

// ── Audit log hook ─────────────────────────────────────────────────────────
export const useAuditLog = (id: string) =>
  useQuery({
    queryKey: [DAMAGE_CASES_KEY, id, 'audit-log'],
    queryFn: () => damageCasesApi.getAuditLog(id).then((r) => r.data),
    enabled: !!id,
  });
