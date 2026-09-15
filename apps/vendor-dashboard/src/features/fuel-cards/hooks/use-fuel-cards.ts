import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fuelCardApi,
  type CreateFuelCardPayload,
  type UpdateFuelCardPayload,
  type CreateFuelCardTopUpPayload,
  type VoidFuelCardTopUpPayload,
  type FuelCardTopUpQuery,
} from '../api/fuel-card.api';

const QUERY_KEY = 'fuel-cards';

export const useFuelCards = () =>
  useQuery({
    queryKey: [QUERY_KEY, 'list'],
    queryFn: () => fuelCardApi.listCards().then((r) => r.data),
  });

export const useFuelCardTopUps = (params?: FuelCardTopUpQuery) =>
  useQuery({
    queryKey: [QUERY_KEY, 'top-ups', params ?? {}],
    queryFn: () => fuelCardApi.listTopUps(params).then((r) => r.data),
  });

// A top-up/void moves the Office Cash Ledger's own balance too (see
// FuelCardService's class doc) — invalidate that feature's queries alongside
// this one so its stats bar / timeline pick up the change immediately.
const INVALIDATE_ALL = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
  queryClient.invalidateQueries({ queryKey: ['van-cash-ledger'] });
};

export const useCreateFuelCard = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateFuelCardPayload) => fuelCardApi.createCard(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success('Fuel card registered');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to register fuel card'), // eslint-disable-line @typescript-eslint/no-explicit-any
  });
};

export const useUpdateFuelCard = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateFuelCardPayload }) => fuelCardApi.updateCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success('Fuel card updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update fuel card'), // eslint-disable-line @typescript-eslint/no-explicit-any
  });
};

export const useCreateFuelCardTopUp = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fuelCardId, data }: { fuelCardId: string; data: CreateFuelCardTopUpPayload }) =>
      fuelCardApi.createTopUp(fuelCardId, data),
    onSuccess: () => {
      INVALIDATE_ALL(queryClient);
      toast.success('Fuel card top-up recorded');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record top-up'), // eslint-disable-line @typescript-eslint/no-explicit-any
  });
};

export const useVoidFuelCardTopUp = () => {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: ({ id, data }: { id: string; data: VoidFuelCardTopUpPayload }) => fuelCardApi.voidTopUp(id, data),
    onSuccess: () => {
      INVALIDATE_ALL(queryClient);
      toast.success('Top-up voided');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to void top-up'), // eslint-disable-line @typescript-eslint/no-explicit-any
  });
};
