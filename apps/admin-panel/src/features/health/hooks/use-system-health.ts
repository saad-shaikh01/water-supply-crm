'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { healthApi } from '../api/health.api';
import { queryKeys } from '../../../lib/query-keys';
import { apiErrorMessage } from '../../../lib/api-error';

export const HEALTH_POLL_MS = 30_000;
export const REFRESH_COOLDOWN_MS = 10_000;

/** Poll every 30s, but not while the tab is hidden. */
export function healthRefetchInterval(): number | false {
  if (typeof document !== 'undefined' && document.hidden) return false;
  return HEALTH_POLL_MS;
}

export function useSystemHealth() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.health.overview,
    queryFn: () => healthApi.get(false),
    refetchInterval: healthRefetchInterval,
    refetchIntervalInBackground: false,
  });

  const [cooldown, setCooldown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const refresh = useMutation({
    mutationFn: () => healthApi.get(true),
    onMutate: () => {
      setCooldown(true);
      timer.current = setTimeout(() => setCooldown(false), REFRESH_COOLDOWN_MS);
    },
    onSuccess: (data) => queryClient.setQueryData(queryKeys.health.overview, data),
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to refresh health')),
  });

  return { ...query, refreshNow: refresh.mutate, refreshDisabled: cooldown || refresh.isPending };
}

export function useFailedJobs(queue: string | null) {
  return useQuery({
    queryKey: queryKeys.health.failedJobs(queue ?? ''),
    queryFn: () => healthApi.failedJobs(queue as string),
    enabled: !!queue,
  });
}
