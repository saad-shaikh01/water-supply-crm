'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { auditApi, type AuditQuery } from '../api/audit.api';
import { queryKeys } from '../../../lib/query-keys';
import { apiErrorMessage } from '../../../lib/api-error';
import { downloadBlob } from '../../observability/lib/csv';
import { compactParams, useUrlFilters } from '../../observability/hooks/use-url-filters';
import { isUuid } from '../../observability/lib/format';

export const AUDIT_FILTER_KEYS = ['vendorId', 'action', 'entity', 'user', 'from', 'to'] as const;

/** `user` is a free text box: a UUID filters by userId, anything else by name (q). */
export function buildAuditQuery(
  values: Record<(typeof AUDIT_FILTER_KEYS)[number], string>,
  page: number,
  limit: number,
): AuditQuery {
  const user = values.user.trim();
  return compactParams({
    vendorId: values.vendorId,
    action: values.action,
    entity: values.entity,
    userId: user && isUuid(user) ? user : '',
    q: user && !isUuid(user) ? user : '',
    from: values.from,
    to: values.to,
    page,
    limit,
  }) as AuditQuery;
}

export function useAuditLogs() {
  const url = useUrlFilters(AUDIT_FILTER_KEYS);
  const params = buildAuditQuery(url.values, url.page, url.limit);
  const query = useQuery({
    queryKey: queryKeys.audit.list(params),
    queryFn: () => auditApi.list(params),
    placeholderData: keepPreviousData,
  });
  return { ...url, params, ...query };
}

export const useAuditFacets = () =>
  useQuery({ queryKey: queryKeys.audit.facets, queryFn: auditApi.facets, staleTime: 5 * 60_000 });

export const useVendorOptions = () =>
  useQuery({ queryKey: ['vendors', 'options'], queryFn: auditApi.vendorOptions, staleTime: 5 * 60_000 });

export function useAuditExport(params: AuditQuery) {
  const [isExporting, setExporting] = useState(false);
  const run = async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { page: _p, limit: _l, ...filters } = params;
    setExporting(true);
    try {
      const { blob, truncated } = await auditApi.exportCsv(filters);
      downloadBlob(blob, `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`);
      if (truncated) toast.warning('Export truncated to the first 50,000 rows. Narrow the filters for the rest.');
      else toast.success('Audit log export downloaded');
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 429) toast.error('Export limit reached, try again in a minute.');
      else if (status === 400) toast.error('Export range is too large. Choose a range of at most 366 days.');
      else toast.error(apiErrorMessage(e, 'Failed to export audit logs'));
    } finally {
      setExporting(false);
    }
  };
  return { run, isExporting };
}
