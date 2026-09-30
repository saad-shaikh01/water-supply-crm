'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Truck, FileWarning, Plus, X } from 'lucide-react';
import { Badge, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Label } from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { useVehicles } from '../hooks/use-fleet';
import { useAllVans } from '../../vans/hooks/use-vans';
import { useCan } from '../../authz/hooks/use-can';
import { VehicleFormDialog } from './dialogs/vehicle-form-dialog';
import type { VehicleListEntry, VehicleSortField } from '../api/fleet.api';
import { FleetMonthPicker } from './fleet-month-picker';
import { fmtKm, fmtMoney, fmtNum, monthLabel } from '../lib/fleet-format';

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' },
  IN_MAINTENANCE: { label: 'In Maintenance', className: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
  RETIRED: { label: 'Retired', className: 'bg-muted text-muted-foreground border-border' },
};

export function VehicleList() {
  const router = useRouter();
  const canUpdate = useCan('fleet:update');
  const {
    data, isLoading, page, setPage, limit, setLimit, search, setSearch, active, setActive,
    month, setMonth, sortBy, sortDir, setSort,
  } = useVehicles();
  const totals = data?.meta.totals;

  // Click a header: same column flips direction, a new column starts at its natural direction.
  const handleSort = (field: string) => {
    const f = field as VehicleSortField;
    if (f === sortBy) setSort(f, sortDir === 'asc' ? 'desc' : 'asc');
    else setSort(f, f === 'plateNumber' ? 'asc' : 'desc');
  };
  const { data: vansPage } = useAllVans();
  const [addOpen, setAddOpen] = useState(false);

  // Van's own display label ("Van1", "Van2"…) — used only to show which
  // route a vehicle's plate is usually linked to. Untouched by this screen.
  const vanLabelById = useMemo(() => {
    const map = new Map<string, string>();
    vansPage?.data.forEach((v) => map.set(v.id, v.plateNumber));
    return map;
  }, [vansPage]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-end gap-3">
          <Input
            placeholder="Search by plate number…"
            value={search}
            onChange={(e) => setSearch(e.target.value || null)}
            className="max-w-xs rounded-xl"
          />
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Month</Label>
            <FleetMonthPicker month={month} onChange={(m) => { setPage(1); setMonth(m); }} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</Label>
            <Select value={active} onValueChange={(v) => { setPage(1); setActive(v); }}>
              <SelectTrigger className="rounded-xl bg-background/50 border-border h-10 w-40">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-border shadow-2xl">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {active !== 'true' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setPage(1); setActive('true'); }}
              className="text-xs text-muted-foreground"
            >
              <X className="h-3.5 w-3.5 mr-1" /> Reset to Active
            </Button>
          )}
        </div>
        {canUpdate && (
          <Button onClick={() => setAddOpen(true)} className="rounded-xl font-bold gap-1.5">
            <Plus className="h-4 w-4" />
            Add Vehicle
          </Button>
        )}
      </div>

      <VehicleFormDialog open={addOpen} onOpenChange={setAddOpen} />

      {totals && (
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border/60 bg-card p-4 sm:grid-cols-4 lg:grid-cols-7">
          {[
            { label: `Fleet · ${monthLabel(month)}`, value: fmtMoney(totals.totalCost), strong: true },
            { label: 'Fuel', value: fmtMoney(totals.fuelCost) },
            { label: 'Maintenance', value: fmtMoney(totals.maintenanceCost) },
            { label: 'Other', value: fmtMoney(totals.otherCost) },
            { label: 'Km driven', value: fmtKm(totals.kmDriven) },
            { label: 'Fuel filled', value: `${fmtNum(totals.fuelLiters, 1)} L` },
            { label: 'Cost / km', value: totals.costPerKm != null ? `₨${fmtNum(totals.costPerKm, 1)}` : '—' },
          ].map((t) => (
            <div key={t.label}>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{t.label}</p>
              <p className={t.strong ? 'text-lg font-black' : 'text-base font-bold'}>{t.value}</p>
            </div>
          ))}
        </div>
      )}

      <DataTable<VehicleListEntry>
        data={data?.data}
        sortKey={sortBy}
        sortDir={sortDir}
        onSort={handleSort}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={data?.meta?.total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No vehicles found"
        onRowClick={(row) => router.push(`/dashboard/fleet/${row.id}`)}
        tableId="fleet-vehicle-list"
        columns={[
          {
            key: 'vehicle',
            essential: true,
            header: 'Vehicle',
            sortable: true,
            sortField: 'plateNumber',
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
            key: 'route',
            header: 'Usual Route',
            defaultVisible: false,
            cell: (row) =>
              row.usualVanId ? (
                <Badge variant="outline" className="font-semibold">{vanLabelById.get(row.usualVanId) ?? '—'}</Badge>
              ) : (
                <span className="text-muted-foreground">Not set</span>
              ),
          },
          {
            key: 'driver',
            header: 'Usual Driver',
            defaultVisible: false,
            cell: (row) => row.usualVanDefaultDriver?.name ?? <span className="text-muted-foreground">Unassigned</span>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (row) => {
              // `isActive` (this Vehicle's own on/off switch — Deactivate/
              // Reactivate) was previously ignored here entirely, so a
              // deactivated vehicle still showed a green "Active" badge
              // (falling through to operationalStatus's own default). That
              // made deactivated duplicates (e.g. leftover placeholder rows
              // from the Van→Vehicle migration backfill) indistinguishable
              // from real active ones in this list.
              if (!row.isActive) {
                return <Badge variant="outline" className="bg-muted text-muted-foreground border-border">Inactive</Badge>;
              }
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
            key: 'km',
            header: 'Km (month)',
            sortable: true,
            sortField: 'kmDriven',
            cell: (row) => (
              <div>
                <p className="font-semibold tabular-nums">{fmtKm(row.period?.kmDriven ?? 0)}</p>
                <p className="text-xs text-muted-foreground">{row.period?.daysUsed ?? 0} day(s) on road</p>
              </div>
            ),
          },
          {
            key: 'fuelCost',
            header: 'Fuel',
            sortable: true,
            sortField: 'fuelCost',
            cell: (row) => (
              <div>
                <p className="font-semibold tabular-nums">{fmtMoney(row.period?.fuelCost)}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtNum(row.period?.fuelLiters ?? 0, 1)} L · {row.period?.fuelFills ?? 0} fill(s)
                </p>
              </div>
            ),
          },
          {
            key: 'maintenanceCost',
            header: 'Maintenance',
            cell: (row) => (
              <div>
                <p className="font-semibold tabular-nums">{fmtMoney(row.period?.maintenanceCost)}</p>
                {!!row.period?.serviceCount && (
                  <p className="text-xs text-muted-foreground">{row.period.serviceCount} service(s)</p>
                )}
              </div>
            ),
          },
          {
            key: 'otherCost',
            header: 'Other',
            cell: (row) => <span className="font-semibold tabular-nums">{fmtMoney(row.period?.otherCost)}</span>,
          },
          {
            key: 'cost',
            header: 'Total',
            sortable: true,
            sortField: 'totalCost',
            cell: (row) => <span className="font-black tabular-nums">{fmtMoney(row.period?.totalCost ?? row.costThisMonth)}</span>,
          },
          {
            key: 'costPerKm',
            header: 'Cost / km',
            sortable: true,
            sortField: 'costPerKm',
            cell: (row) => (row.period?.costPerKm != null ? `₨${fmtNum(row.period.costPerKm, 1)}` : '—'),
          },
          {
            key: 'kmPerLiter',
            header: 'Avg km/L',
            cell: (row) => (row.period?.avgKmPerLiter != null ? fmtNum(row.period.avgKmPerLiter, 1) : '—'),
          },
        ]}
      />
    </div>
  );
}
