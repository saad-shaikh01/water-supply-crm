import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import {
  fleetApi,
  type VehicleSortField,
  type UpdateVehicleProfileData,
  type CreateVehicleDocumentData,
  type CreateVehicleData,
  type UpdateVehicleData,
} from '../api/fleet.api';
import { queryKeys } from '../../../lib/query-keys';
import { currentMonth } from '../lib/fleet-format';

export const useVehicles = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));
  // Defaults to active-only; explicitly cleared to 'all' to reveal deactivated vehicles too.
  const [active, setActive] = useQueryState('active', parseAsString.withDefault('true'));
  // "YYYY-MM"; the list's cost/km columns and the overview cards follow it.
  const [month, setMonth] = useQueryState('month', parseAsString.withDefault(currentMonth()));
  const [sortBy, setSortBy] = useQueryState('sortBy', parseAsString.withDefault('plateNumber'));
  const [sortDir, setSortDir] = useQueryState('sortDir', parseAsString.withDefault('asc'));

  const params = {
    page,
    limit,
    search: search || undefined,
    active: active === 'true' ? true : active === 'false' ? false : undefined,
    month,
    sortBy: sortBy as VehicleSortField,
    sortDir: sortDir as 'asc' | 'desc',
  };

  return {
    ...useQuery({
      queryKey: queryKeys.fleet.vehicles(params),
      queryFn: () => fleetApi.getVehicles(params),
      staleTime: 60 * 1000,
      placeholderData: (prev) => prev,
    }),
    page,
    setPage,
    limit,
    setLimit,
    search,
    setSearch,
    active,
    setActive,
    month,
    setMonth,
    sortBy,
    sortDir,
    setSort: (field: VehicleSortField, dir: 'asc' | 'desc') => {
      setPage(1);
      setSortBy(field);
      setSortDir(dir);
    },
  };
};

/** Fleet-wide totals for a month (same source as the list footer, so the numbers always match). */
export const useFleetMonthTotals = (month: string) =>
  useQuery({
    queryKey: queryKeys.fleet.vehicles({ totalsFor: month }),
    queryFn: () => fleetApi.getVehicles({ active: true, month, limit: 1 }),
    staleTime: 60 * 1000,
    select: (r) => r.meta.totals,
  });

export const useVehiclePeriodSummary = (vehicleId: string | undefined, range: { dateFrom?: string; dateTo?: string }) =>
  useQuery({
    queryKey: queryKeys.fleet.periodSummary(vehicleId ?? '', range),
    queryFn: () => fleetApi.getPeriodSummary(vehicleId as string, range),
    enabled: !!vehicleId,
    placeholderData: (prev) => prev,
  });

export const useVehicleMonthlyReport = (vehicleId: string | undefined, months = 12) =>
  useQuery({
    queryKey: queryKeys.fleet.monthlyReport(vehicleId ?? '', { months }),
    queryFn: () => fleetApi.getMonthlyReport(vehicleId as string, { months }),
    enabled: !!vehicleId,
    staleTime: 60 * 1000,
  });

export const useVehicleOtherExpenses = (
  vehicleId: string | undefined,
  params: { dateFrom?: string; dateTo?: string; page?: number; limit?: number },
) =>
  useQuery({
    queryKey: queryKeys.fleet.otherExpenses(vehicleId ?? '', params),
    queryFn: () => fleetApi.getOtherExpenses(vehicleId as string, params),
    enabled: !!vehicleId,
    placeholderData: (prev) => prev,
  });

/**
 * Lightweight active-vehicle pool for the Vehicle Check start picker (§17.3)
 * — no pagination params needed, this is meant for a searchable dropdown of
 * the whole active fleet.
 */
export const useActiveVehiclesForPicker = () =>
  useQuery({
    queryKey: queryKeys.fleet.vehicles({ active: true, limit: 100 }),
    queryFn: () => fleetApi.getVehicles({ active: true, limit: 100 }),
    staleTime: 60 * 1000,
  });

export const useVehicle = (vehicleId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.fleet.vehicle(vehicleId ?? ''),
    queryFn: () => fleetApi.getVehicle(vehicleId as string),
    enabled: !!vehicleId,
  });

export const useFleetOverview = () =>
  useQuery({
    queryKey: queryKeys.fleet.overview(),
    queryFn: () => fleetApi.getOverview(),
    staleTime: 5 * 60 * 1000,
  });

export const useVehicleCostSummary = (vehicleId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.fleet.costSummary(vehicleId ?? ''),
    queryFn: () => fleetApi.getCostSummary(vehicleId as string),
    enabled: !!vehicleId,
  });

export const useCreateVehicle = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateVehicleData) => fleetApi.createVehicle(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicles() });
      toast.success('Vehicle added');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add vehicle'),
  });
};

export const useUpdateVehicleBasic = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ vehicleId, data }: { vehicleId: string; data: UpdateVehicleData }) =>
      fleetApi.updateVehicleBasic(vehicleId, data),
    onSuccess: (_result, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicle(vehicleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicles() });
      toast.success('Vehicle updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update vehicle'),
  });
};

export const useDeactivateVehicle = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vehicleId: string) => fleetApi.deactivateVehicle(vehicleId),
    onSuccess: (_result, vehicleId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicle(vehicleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicles() });
      toast.success('Vehicle deactivated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to deactivate vehicle'),
  });
};

export const useReactivateVehicle = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vehicleId: string) => fleetApi.reactivateVehicle(vehicleId),
    onSuccess: (_result, vehicleId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicle(vehicleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicles() });
      toast.success('Vehicle reactivated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to reactivate vehicle'),
  });
};

export const useUpdateVehicleProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ vehicleId, data }: { vehicleId: string; data: UpdateVehicleProfileData }) =>
      fleetApi.updateVehicleProfile(vehicleId, data),
    onSuccess: (_result, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicle(vehicleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicles() });
      toast.success('Vehicle profile updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update vehicle profile'),
  });
};

export const useAddVehicleDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ vehicleId, data }: { vehicleId: string; data: CreateVehicleDocumentData }) =>
      fleetApi.addDocument(vehicleId, data),
    onSuccess: (_result, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicle(vehicleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.overview() });
      toast.success('Document added');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add document'),
  });
};

export const useUpdateVehicleDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateVehicleDocumentData> }) =>
      fleetApi.updateDocument(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicles() });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.overview() });
      toast.success('Document updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update document'),
  });
};

export const useDeactivateVehicleDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fleetApi.deactivateDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicles() });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.overview() });
      toast.success('Document removed');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to remove document'),
  });
};
