'use client';

import { useState } from 'react';
import { Button, Input, Label } from '@water-supply-crm/ui';
import { X } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { NativeSelect } from '../../observability/components/native-select';
import { compactParams, useUrlFilters } from '../../observability/hooks/use-url-filters';
import { useVendorOptions } from '../../audit/hooks/use-audit-logs';
import { IMPORT_ENTITIES, IMPORT_STATUSES } from '../api/imports.api';
import { useImports, useImportStats } from '../hooks/use-imports';
import { StatsStrip } from './stats-strip';
import { ImportsTable } from './imports-table';
import { ImportDetailDrawer } from './import-detail-drawer';

const KEYS = ['vendorId', 'status', 'entity', 'from', 'to'] as const;

export function ImportsPageClient() {
  const url = useUrlFilters(KEYS);
  const vendors = useVendorOptions();
  const stats = useImportStats();
  const params = compactParams({ ...url.values, page: url.page, limit: url.limit });
  const list = useImports(params);
  const [selected, setSelected] = useState<string | null>(null);
  const hasFilters = Object.values(url.values).some(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader title="Import Jobs" description="Vendor data imports across the platform" />
      <StatsStrip stats={stats.data} />
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label htmlFor="imp-vendor">Vendor</Label>
          <NativeSelect id="imp-vendor" value={url.values.vendorId} onChange={(e) => url.setFilters({ vendorId: e.target.value })}>
            <option value="">All vendors</option>
            {(vendors.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="imp-status">Status</Label>
          <NativeSelect id="imp-status" value={url.values.status} onChange={(e) => url.setFilters({ status: e.target.value })}>
            <option value="">All statuses</option>
            {IMPORT_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="imp-entity">Entity</Label>
          <NativeSelect id="imp-entity" value={url.values.entity} onChange={(e) => url.setFilters({ entity: e.target.value })}>
            <option value="">All entities</option>
            {IMPORT_ENTITIES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="imp-from">From</Label>
          <Input id="imp-from" type="date" value={url.values.from} onChange={(e) => url.setFilters({ from: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="imp-to">To</Label>
          <Input id="imp-to" type="date" value={url.values.to} onChange={(e) => url.setFilters({ to: e.target.value })} />
        </div>
        {hasFilters && (
          <div>
            <Button variant="ghost" size="sm" onClick={url.clear}>
              <X className="mr-1 h-4 w-4" /> Clear filters
            </Button>
          </div>
        )}
      </div>
      <ImportsTable
        rows={list.data?.data ?? []}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onSelect={(r) => setSelected(r.id)}
        pagination={{
          page: url.page,
          limit: url.limit,
          total: list.data?.meta?.total ?? 0,
          onPageChange: url.setPage,
          onLimitChange: url.setLimit,
        }}
      />
      <ImportDetailDrawer id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
