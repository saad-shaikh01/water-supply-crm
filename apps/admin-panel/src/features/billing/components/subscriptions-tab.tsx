'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Input } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../../components/shared/data-table';
import { NativeSelect } from '../../observability/components/native-select';
import { compactParams, useUrlFilters } from '../../observability/hooks/use-url-filters';
import { usePlans, useSubscriptions } from '../hooks/use-billing';
import { exceedsLimits, fmtDate, subscriptionVariant } from '../lib/billing';
import type { SubscriptionRow } from '../api/billing.api';
import { UsageBars } from './usage-bars';
import { AssignSubscriptionDialog } from './assign-subscription-dialog';
import { VendorSubscriptionDialog } from './vendor-subscription-card';

const KEYS = ['sstatus', 'splan', 'sq'] as const;

export function SubscriptionsTab() {
  const url = useUrlFilters(KEYS);
  const [search, setSearch] = useState(url.values.sq);
  useEffect(() => setSearch(url.values.sq), [url.values.sq]);
  useEffect(() => {
    if (search === url.values.sq) return;
    const t = setTimeout(() => url.setFilters({ sq: search }), 400);
    return () => clearTimeout(t);
  }, [search]);

  const plans = usePlans();
  const params = compactParams({ status: url.values.sstatus, planId: url.values.splan, q: url.values.sq, page: url.page, limit: url.limit });
  const { data, isLoading, error, refetch } = useSubscriptions(params);
  const [assignOpen, setAssignOpen] = useState(false);
  const [details, setDetails] = useState<{ id: string; name: string } | null>(null);

  const columns: DataTableColumn<SubscriptionRow>[] = [
    { key: 'vendor', header: 'Vendor', cell: (r) => <span className="font-medium">{r.vendor.name}</span> },
    { key: 'plan', header: 'Plan', cell: (r) => r.plan.name },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <Badge variant={subscriptionVariant[r.status]} data-status={r.status}>
          {r.status.replace('_', ' ')}
        </Badge>
      ),
    },
    { key: 'usage', header: 'Usage', className: 'min-w-[180px]', cell: (r) => <UsageBars usage={r.usage} limits={r.limits} /> },
    { key: 'trial', header: 'Trial ends', cell: (r) => fmtDate(r.trialEndsAt) },
    { key: 'end', header: 'Period ends', cell: (r) => fmtDate(r.currentPeriodEnd) },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          {exceedsLimits(r.usage, r.limits) && <Badge variant="warning">Over limit</Badge>}
          <Button size="sm" variant="outline" aria-label={`Manage ${r.vendor.name}`} onClick={() => setDetails(r.vendor)}>
            Manage
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input aria-label="Search vendors" placeholder="Search vendor name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect aria-label="Filter by status" value={url.values.sstatus} onChange={(e) => url.setFilters({ sstatus: e.target.value })}>
          <option value="">All statuses</option>
          <option value="TRIAL">Trial</option>
          <option value="ACTIVE">Active</option>
          <option value="PAST_DUE">Past due</option>
          <option value="CANCELLED">Cancelled</option>
        </NativeSelect>
        <NativeSelect aria-label="Filter by plan" value={url.values.splan} onChange={(e) => url.setFilters({ splan: e.target.value })}>
          <option value="">All plans</option>
          {(plans.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <div className="flex justify-end">
          <Button onClick={() => setAssignOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Assign plan
          </Button>
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(r) => r.vendor.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        empty={{ title: 'No subscriptions', description: 'Vendors without a subscription are not subject to plan limits.' }}
        pagination={{ page: url.page, limit: url.limit, total: data?.meta?.total ?? 0, onPageChange: url.setPage, onLimitChange: url.setLimit }}
      />
      <AssignSubscriptionDialog open={assignOpen} onClose={() => setAssignOpen(false)} />
      <VendorSubscriptionDialog vendor={details} onClose={() => setDetails(null)} />
    </div>
  );
}
