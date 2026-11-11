'use client';

import { useEffect, useState } from 'react';
import { Input } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { NativeSelect } from '../../observability/components/native-select';
import { compactParams, useUrlFilters } from '../../observability/hooks/use-url-filters';
import { useWhatsAppAccounts } from '../hooks/use-whatsapp-accounts';
import { AccountsTable } from './accounts-table';

const KEYS = ['status', 'q'] as const;

export function WhatsAppPageClient() {
  const url = useUrlFilters(KEYS);
  const [search, setSearch] = useState(url.values.q);
  useEffect(() => setSearch(url.values.q), [url.values.q]);
  useEffect(() => {
    if (search === url.values.q) return;
    const t = setTimeout(() => url.setFilters({ q: search }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const params = compactParams({ status: url.values.status, q: url.values.q, page: url.page, limit: url.limit });
  const { data, isLoading, error, refetch } = useWhatsAppAccounts(params);

  return (
    <div className="space-y-6">
      <PageHeader title="WhatsApp Accounts" description="Sender accounts and the vendors assigned to them" />
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Input aria-label="Search accounts" placeholder="Search label, number or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect aria-label="Filter by status" value={url.values.status} onChange={(e) => url.setFilters({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="READY">Ready</option>
          <option value="TOKEN_INVALID">Credentials invalid</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="NOT_CONFIGURED">Not configured</option>
        </NativeSelect>
      </div>
      <AccountsTable
        rows={data?.data ?? []}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        pagination={{
          page: url.page,
          limit: url.limit,
          total: data?.meta?.total ?? 0,
          onPageChange: url.setPage,
          onLimitChange: url.setLimit,
        }}
      />
    </div>
  );
}
