import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import {
  fleetApi,
  type UpdateVehicleProfileData,
  type CreateVehicleDocumentData,
  type CreateVehicleData,
  type UpdateVehicleData,
} from '../api/fleet.api';
import { queryKeys } from '../../../lib/query-keys';

export const useVehicles = () => {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));

  const params = { page, limit, search: search || undefined };

  return {
    ...useQuery({
      queryKey: queryKeys.fleet.vehicles(params),
      queryFn: () => fleetApi.getVehicles(params),
      staleTime: 5 * 60 * 1000,
    }),
    page,
    setPage,
    limit,
    setLimit,
    search,
    setSearch,
  };
};

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
