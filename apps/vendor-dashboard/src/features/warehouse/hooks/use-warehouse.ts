import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { warehouseApi } from '../api/warehouse.api';
import { queryKeys } from '../../../lib/query-keys';

// ── Stock ───────────────────────────────────────────────────────────────────

export const useWarehouseStock = () =>
  useQuery({
    queryKey: queryKeys.warehouse.stock(),
    queryFn: () => warehouseApi.getStock().then((r) => r.data),
  });

// ── Universe ────────────────────────────────────────────────────────────────

export const useWarehouseUniverse = () =>
  useQuery({
    queryKey: queryKeys.warehouse.universe(),
    queryFn: () => warehouseApi.getUniverse().then((r) => r.data),
  });

// ── Transactions ────────────────────────────────────────────────────────────

export const useWarehouseTransactions = (params: {
  page?: number;
  limit?: number;
  productId?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}) =>
  useQuery({
    queryKey: queryKeys.warehouse.transactions(params),
    queryFn: () => warehouseApi.getTransactions(params).then((r) => r.data),
  });

// ── Repair Batches ──────────────────────────────────────────────────────────

export const useRepairBatches = (params: {
  page?: number;
  limit?: number;
  productId?: string;
  status?: string;
}) =>
  useQuery({
    queryKey: queryKeys.warehouse.repairs(params),
    queryFn: () => warehouseApi.getRepairBatches(params).then((r) => r.data),
  });

// ── Opening Balance ─────────────────────────────────────────────────────────

export const useOpeningBalance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof warehouseApi.openingBalance>[0]) =>
      warehouseApi.openingBalance(data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.stock() });
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.universe() });
      queryClient.invalidateQueries({ queryKey: ['warehouse', 'transactions'] });
      toast.success('Opening balance set');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to set opening balance'),
  });
};

// ── Fill In ─────────────────────────────────────────────────────────────────

export const useFillIn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof warehouseApi.fillIn>[0]) =>
      warehouseApi.fillIn(data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.stock() });
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.universe() });
      queryClient.invalidateQueries({ queryKey: ['warehouse', 'transactions'] });
      toast.success('Fill-in recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record fill-in'),
  });
};

// ── Refill ──────────────────────────────────────────────────────────────────

export const useRefill = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof warehouseApi.refill>[0]) =>
      warehouseApi.refill(data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.stock() });
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.universe() });
      queryClient.invalidateQueries({ queryKey: ['warehouse', 'transactions'] });
      toast.success('Refill recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record refill'),
  });
};

// ── Mark Damaged ────────────────────────────────────────────────────────────

export const useMarkDamaged = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof warehouseApi.markDamaged>[0]) =>
      warehouseApi.markDamaged(data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.stock() });
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.universe() });
      queryClient.invalidateQueries({ queryKey: ['warehouse', 'transactions'] });
      toast.success('Bottles marked as damaged');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to mark damaged'),
  });
};

// ── Mark Leaked ─────────────────────────────────────────────────────────────

export const useMarkLeaked = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof warehouseApi.markLeaked>[0]) =>
      warehouseApi.markLeaked(data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.stock() });
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.universe() });
      queryClient.invalidateQueries({ queryKey: ['warehouse', 'transactions'] });
      toast.success('Bottles marked as leaked');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to mark leaked'),
  });
};

// ── Send Repair ─────────────────────────────────────────────────────────────

export const useSendRepair = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof warehouseApi.sendRepair>[0]) =>
      warehouseApi.sendRepair(data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.stock() });
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.universe() });
      queryClient.invalidateQueries({ queryKey: ['warehouse', 'transactions'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse', 'repairs'] });
      toast.success('Bottles sent for repair');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to send for repair'),
  });
};

// ── Return Repair ───────────────────────────────────────────────────────────

export const useReturnRepair = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, data }: { batchId: string; data: Parameters<typeof warehouseApi.returnRepair>[1] }) =>
      warehouseApi.returnRepair(batchId, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.stock() });
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.universe() });
      queryClient.invalidateQueries({ queryKey: ['warehouse', 'transactions'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse', 'repairs'] });
      toast.success('Repair return recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record repair return'),
  });
};

// ── Write Off ───────────────────────────────────────────────────────────────

export const useWriteOff = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof warehouseApi.writeOff>[0]) =>
      warehouseApi.writeOff(data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.stock() });
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.universe() });
      queryClient.invalidateQueries({ queryKey: ['warehouse', 'transactions'] });
      toast.success('Bottles written off');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to write off'),
  });
};

// ── Adjustment ──────────────────────────────────────────────────────────────

export const useAdjustment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof warehouseApi.adjustment>[0]) =>
      warehouseApi.adjustment(data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.stock() });
      queryClient.invalidateQueries({ queryKey: queryKeys.warehouse.universe() });
      queryClient.invalidateQueries({ queryKey: ['warehouse', 'transactions'] });
      toast.success('Adjustment recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record adjustment'),
  });
};
