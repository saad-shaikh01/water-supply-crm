'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { settingsApi, type PlatformSettingsResponse, type SettingValue } from '../api/settings.api';
import { queryKeys } from '../../../lib/query-keys';
import { apiErrorMessage } from '../../../lib/api-error';

export const usePlatformSettings = (options: { refetchInterval?: number } = {}) =>
  useQuery({
    queryKey: queryKeys.platformSettings.all,
    queryFn: settingsApi.list,
    ...options,
  });

/** Value lookup that falls back to the registry default. */
export function settingValue(data: PlatformSettingsResponse | undefined, key: string): SettingValue {
  const entry = data?.settings.find((s) => s.key === key);
  return entry ? entry.value : null;
}

/**
 * Atomic batch update with an optimistic cache write; on failure the previous cache is restored
 * (so toggles roll back) and the server message is toasted.
 */
export const useUpdateSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, SettingValue>) => settingsApi.patch(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: queryKeys.platformSettings.all });
      const previous = qc.getQueryData<PlatformSettingsResponse>(queryKeys.platformSettings.all);
      if (previous) {
        qc.setQueryData<PlatformSettingsResponse>(queryKeys.platformSettings.all, {
          settings: previous.settings.map((s) => (s.key in patch ? { ...s, value: patch[s.key] } : s)),
        });
      }
      return { previous };
    },
    onError: (e, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.platformSettings.all, ctx.previous);
      toast.error(apiErrorMessage(e, 'Could not save the setting.'));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.platformSettings.all }),
  });
};
