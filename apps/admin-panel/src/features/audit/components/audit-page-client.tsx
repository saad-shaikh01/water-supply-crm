'use client';

import { useState } from 'react';
import { Button } from '@water-supply-crm/ui';
import { Download } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { useAuditExport, useAuditFacets, useAuditLogs, useVendorOptions } from '../hooks/use-audit-logs';
import { AuditFilters } from './audit-filters';
import { AuditTable } from './audit-table';
import { AuditDetailDrawer } from './audit-detail-drawer';
import type { AuditRow } from '../api/audit.api';

export function AuditPageClient() {
  const logs = useAuditLogs();
  const facets = useAuditFacets();
  const vendors = useVendorOptions();
  const exporter = useAuditExport(logs.params);
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const busy = logs.isLoading || exporter.isExporting;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="Every recorded change across all vendors"
        actions={
          <Button
            variant="outline"
            onClick={exporter.run}
            disabled={busy}
            title={busy ? 'Please wait' : 'Exports up to 50,000 rows matching the current filters (default: last 30 days)'}
          >
            <Download className="mr-2 h-4 w-4" />
            {exporter.isExporting ? 'Exporting...' : 'Export CSV'}
          </Button>
        }
      />
      <AuditFilters
        values={logs.values}
        vendors={vendors.data ?? []}
        facets={facets.data}
        onChange={logs.setFilters}
        onClear={logs.clear}
      />
      <p className="text-xs text-muted-foreground">CSV export is capped at 50,000 rows; without a date range it covers the last 30 days.</p>
      <AuditTable
        rows={logs.data?.data ?? []}
        isLoading={logs.isLoading}
        error={logs.error}
        onRetry={() => logs.refetch()}
        onSelect={setSelected}
        pagination={{
          page: logs.page,
          limit: logs.limit,
          total: logs.data?.meta?.total ?? 0,
          onPageChange: logs.setPage,
          onLimitChange: logs.setLimit,
        }}
      />
      <AuditDetailDrawer row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
