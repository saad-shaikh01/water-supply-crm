'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ACTIVE_STATUSES, importsApi, type ImportsQuery, type ImportsResponse } from '../api/imports.api';
import { queryKeys } from '../../../lib/query-keys';

export const IMPORTS_POLL_MS = 15_000;

/** Poll only while a visible row is still moving. */
export function importsRefetchInterval(data: ImportsResponse | undefined): number | false {
  if (typeof document !== 'undefined' && document.hidden) return false;
  return data?.data?.some((r) => ACTIVE_STATUSES.includes(r.status)) ? IMPORTS_POLL_MS : false;
}

export const useImports = (params: ImportsQuery) =>
  useQuery({
    queryKey: queryKeys.imports.list(params),
    queryFn: () => importsApi.list(params),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => importsRefetchInterval(q.state.data),
  });

export const useImportStats = () =>
  useQuery({ queryKey: queryKeys.imports.stats, queryFn: importsApi.stats, refetchInterval: 60_000 });

export const useImportDetail = (id: string | null) =>
  useQuery({ queryKey: queryKeys.imports.detail(id ?? ''), queryFn: () => importsApi.detail(id as string), enabled: !!id });
