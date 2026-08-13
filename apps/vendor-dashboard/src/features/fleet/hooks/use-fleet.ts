import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { toast } from 'sonner';
import { fleetApi, type UpdateVehicleProfileData, type CreateVehicleDocumentData } from '../api/fleet.api';
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

export const useVehicle = (vanId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.fleet.vehicle(vanId ?? ''),
    queryFn: () => fleetApi.getVehicle(vanId as string),
    enabled: !!vanId,
  });

export const useFleetOverview = () =>
  useQuery({
    queryKey: queryKeys.fleet.overview(),
    queryFn: () => fleetApi.getOverview(),
    staleTime: 5 * 60 * 1000,
  });

export const useVehicleCostSummary = (vanId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.fleet.costSummary(vanId ?? ''),
    queryFn: () => fleetApi.getCostSummary(vanId as string),
    enabled: !!vanId,
  });

export const useUpdateVehicleProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ vanId, data }: { vanId: string; data: UpdateVehicleProfileData }) =>
      fleetApi.updateVehicleProfile(vanId, data),
    onSuccess: (_result, { vanId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicle(vanId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicles() });
      toast.success('Vehicle profile updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update vehicle profile'),
  });
};

export const useAddVehicleDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ vanId, data }: { vanId: string; data: CreateVehicleDocumentData }) =>
      fleetApi.addDocument(vanId, data),
    onSuccess: (_result, { vanId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet.vehicle(vanId) });
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
