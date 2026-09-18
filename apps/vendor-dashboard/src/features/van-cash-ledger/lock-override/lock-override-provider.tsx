'use client';

import { useEffect } from 'react';
import { apiClient } from '@water-supply-crm/data-access';
import type { PeriodClosedErrorBody } from '../api/van-cash-ledger.api';
import { LockOverrideDialog } from './lock-override-dialog';
import {
  buildOverrideRetryConfig, requestOverride, shouldPromptOverride, useLockOverrideStore,
} from './lock-override-store';

/**
 * Mounted once for every dashboard page. Registers a response-error interceptor
 * on the shared `apiClient` that turns an overridable `PERIOD_CLOSED` rejection
 * into: ask for a reason (one dialog at a time) → replay the SAME request with
 * the override header → resolve with the replay's result, so the caller's
 * mutation simply succeeds (its own onSuccess toast fires). Cancel → reject with
 * the ORIGINAL error (the mutation's onError shows the server message).
 *
 * Ordering: the auth interceptor (401 refresh, libs/data-access) is registered
 * at module load, so it runs first and passes non-401s through; ours only ever
 * sees 403 PERIOD_CLOSED. Replays go through the whole chain again (fresh
 * bearer token, a 401 mid-dialog still refreshes) but carry `_lockOverrideRetried`,
 * so they can never be prompted or retried twice.
 */
export function LockOverrideProvider() {
  useEffect(() => {
    const id = apiClient.interceptors.response.use(undefined, async (error: unknown) => {
      if (!shouldPromptOverride(error)) return Promise.reject(error);

      const body = error.response?.data as PeriodClosedErrorBody;
      const reason = await requestOverride({
        periods: Array.isArray(body.periods) ? body.periods : [],
        message: body.message,
      });
      if (reason === null) return Promise.reject(error);

      return apiClient.request(buildOverrideRetryConfig(error.config, reason));
    });

    return () => {
      apiClient.interceptors.response.eject(id);
      // Don't leave requests hanging on a dialog that no longer exists.
      useLockOverrideStore.getState().cancelAll();
    };
  }, []);

  return <LockOverrideDialog />;
}
