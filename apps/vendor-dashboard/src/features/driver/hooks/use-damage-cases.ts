import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { damageCaseApi, type DamageCaseStatus } from '../api/damage-case.api';

const KEYS = {
  myCases: (params?: object) => ['damage-cases', 'my-cases', params] as const,
  one: (id: string) => ['damage-cases', id] as const,
};

export const useMyDamageCases = (params?: {
  page?: number;
  limit?: number;
  status?: DamageCaseStatus;
}) => {
  return useQuery({
    queryKey: KEYS.myCases(params),
    queryFn: () => damageCaseApi.getMyDamageCases(params),
    staleTime: 30_000,
  });
};

export const useDamageCase = (id: string) => {
  return useQuery({
    queryKey: KEYS.one(id),
    queryFn: () => damageCaseApi.getDamageCase(id),
    enabled: !!id,
    staleTime: 30_000,
  });
};

export const useReportDamage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: damageCaseApi.reportDamage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['damage-cases', 'my-cases'] });
      toast.success('Damage case reported successfully');
    },
    // Note: 409 handling is done in the component to access existingCaseId from response
  });
};

export const useUploadDamagePhoto = () => {
  return useMutation({
    mutationFn: (file: File) => damageCaseApi.uploadPhoto(file),
    onError: () => toast.error('Failed to upload photo'),
  });
};

export const useUpdateDamageCase = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, bottleCount, version }: { id: string; bottleCount: number; version: number }) =>
      damageCaseApi.updateDamageCase(id, { bottleCount, version }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: KEYS.one(data.id) });
      queryClient.invalidateQueries({ queryKey: ['damage-cases', 'my-cases'] });
      toast.success('Damage case updated successfully');
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err?.response?.data?.message ?? 'Failed to update damage case');
    },
  });
};
