'use client';

import { useRouter } from 'next/navigation';
import { Truck, FileWarning } from 'lucide-react';
import { Badge, Input } from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { useVehicles } from '../hooks/use-fleet';
import type { VehicleListEntry } from '../api/fleet.api';

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' },
  IN_MAINTENANCE: { label: 'In Maintenance', className: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
  RETIRED: { label: 'Retired', className: 'bg-muted text-muted-foreground border-border' },
};

export function VehicleList() {
  const router = useRouter();
  const { data, isLoading, page, setPage, limit, setLimit, search, setSearch } = useVehicles();

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search by plate number…"
        value={search}
        onChange={(e) => setSearch(e.target.value || null)}
        className="max-w-xs rounded-xl"
      />

      <DataTable<VehicleListEntry>
        data={data?.data}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={data?.meta?.total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No vehicles found"
        onRowClick={(row) => router.push(`/dashboard/fleet/${row.id}`)}
        columns={[
          {
            key: 'vehicle',
            header: 'Vehicle',
            cell: (row) => (
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="font-semibold">{row.plateNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {[row.profile?.make, row.profile?.model].filter(Boolean).join(' ') || 'No profile yet'}
                  </p>
                </div>
              </div>
            ),
          },
          {
            key: 'driver',
            header: 'Usual Driver',
            cell: (row) => row.usualVanDefaultDriver?.name ?? <span className="text-muted-foreground">Unassigned</span>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (row) => {
              const status = row.profile?.operationalStatus ?? 'ACTIVE';
              const cfg = STATUS_LABEL[status] ?? STATUS_LABEL.ACTIVE;
              return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
            },
          },
          {
            key: 'odometer',
            header: 'Odometer',
            cell: (row) => (row.profile ? `${row.profile.currentOdometer.toLocaleString()} km` : '—'),
          },
          {
            key: 'documents',
            header: 'Documents',
            cell: (row) =>
              row.expiringDocumentCount > 0 ? (
                <span className="inline-flex items-center gap-1 text-amber-500 text-xs font-semibold">
                  <FileWarning className="h-3.5 w-3.5" />
                  {row.expiringDocumentCount} expiring
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">OK</span>
              ),
          },
          {
            key: 'cost',
            header: 'Cost this month',
            cell: (row) => `₨${row.costThisMonth.toLocaleString()}`,
          },
        ]}
      />
    </div>
  );
}
