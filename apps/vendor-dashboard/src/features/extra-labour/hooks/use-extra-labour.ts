import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseAsBoolean, parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import {
  extraLabourApi,
  CreateExtraLabourDto,
  CreateLabourTypeDto,
  UpdateExtraLabourDto,
  UpdateLabourTypeDto,
} from '../api/extra-labour.api';

export const EXTRA_LABOUR_QUERY_KEYS = {
  all: ['extra-labour'] as const,
  list: (params: Record<string, unknown>) => ['extra-labour', 'list', params] as const,
  summary: (from?: string, to?: string) => ['extra-labour', 'summary', { from, to }] as const,
  types: (includeInactive: boolean) => ['extra-labour', 'types', { includeInactive }] as const,
  options: (search?: string, labourTypeId?: string, isActive?: boolean) =>
    ['extra-labour', 'options', { search, labourTypeId, isActive }] as const,
  profile: (id: string) => ['extra-labour', 'profile', id] as const,
  payments: (id: string, params: Record<string, unknown>) =>
    ['extra-labour', 'payments', id, params] as const,
};

export function useExtraLabourFilters() {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [limit, setLimit] = useQueryState('limit', parseAsInteger.withDefault(20));
  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));
  const [labourTypeId, setLabourTypeId] = useQueryState(
    'labourTypeId',
    parseAsString.withDefault(''),
  );
  const [isActive, setIsActive] = useQueryState(
    'isActive',
    parseAsString.withDefault('all'),
  );

  return {
    page,
    setPage,
    limit,
    setLimit,
    search,
    setSearch,
    labourTypeId,
    setLabourTypeId,
    isActive,
    setIsActive,
  };
}

export function useExtraLabourList() {
  const filters = useExtraLabourFilters();
  const activeBool =
    filters.isActive === 'true' ? true : filters.isActive === 'false' ? false : undefined;

  const queryParams = {
    page: filters.page,
    limit: filters.limit,
    search: filters.search || undefined,
    labourTypeId: filters.labourTypeId || undefined,
    isActive: activeBool,
  };

  const query = useQuery({
    queryKey: EXTRA_LABOUR_QUERY_KEYS.list(queryParams),
    queryFn: async () => {
      const res = await extraLabourApi.getList(queryParams);
      return res.data;
    },
  });

  return {
    ...query,
    filters,
  };
}

export function useExtraLabourSummary(from?: string, to?: string) {
  return useQuery({
    queryKey: EXTRA_LABOUR_QUERY_KEYS.summary(from, to),
    queryFn: async () => {
      const res = await extraLabourApi.getSummary(from, to);
      return res.data;
    },
  });
}

export function useExtraLabourTypes(includeInactive = false) {
  return useQuery({
    queryKey: EXTRA_LABOUR_QUERY_KEYS.types(includeInactive),
    queryFn: async () => {
      const res = await extraLabourApi.getLabourTypes(includeInactive);
      return res.data;
    },
  });
}

export function useExtraLabourOptions(
  search?: string,
  labourTypeId?: string,
  isActive = true,
  enabled = true,
) {
  return useQuery({
    queryKey: EXTRA_LABOUR_QUERY_KEYS.options(search, labourTypeId, isActive),
    queryFn: async () => {
      const res = await extraLabourApi.getOptions(search, labourTypeId, isActive);
      return res.data;
    },
    enabled,
  });
}

export function useExtraLabourProfile(id?: string | null) {
  return useQuery({
    queryKey: EXTRA_LABOUR_QUERY_KEYS.profile(id ?? ''),
    queryFn: async () => {
      if (!id) throw new Error('ID required');
      const res = await extraLabourApi.getProfile(id);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useExtraLabourPayments(
  id: string | null,
  params: { page?: number; limit?: number; from?: string; to?: string } = {},
) {
  return useQuery({
    queryKey: EXTRA_LABOUR_QUERY_KEYS.payments(id ?? '', params),
    queryFn: async () => {
      if (!id) throw new Error('ID required');
      const res = await extraLabourApi.getPayments(id, params);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateExtraLabour() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateExtraLabourDto) => extraLabourApi.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXTRA_LABOUR_QUERY_KEYS.all });
    },
  });
}

export function useUpdateExtraLabour() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateExtraLabourDto }) =>
      extraLabourApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: EXTRA_LABOUR_QUERY_KEYS.all });
      queryClient.invalidateQueries({ queryKey: EXTRA_LABOUR_QUERY_KEYS.profile(id) });
    },
  });
}

export function useCreateLabourType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateLabourTypeDto) => extraLabourApi.createLabourType(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXTRA_LABOUR_QUERY_KEYS.all });
    },
  });
}

export function useUpdateLabourType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateLabourTypeDto }) =>
      extraLabourApi.updateLabourType(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXTRA_LABOUR_QUERY_KEYS.all });
    },
  });
}
