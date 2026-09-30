'use client';

import { useEffect, useMemo, useState } from 'react';
import { Wrench, User as UserIcon, Gauge, Store, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, Button, Skeleton } from '@water-supply-crm/ui';
import { useServiceRecords, useServiceTypes } from '../hooks/use-maintenance';
import { fmtDate, fmtMoney } from '../lib/fleet-format';
import type { FleetPeriod } from './fleet-period-picker';

const PAGE_SIZE = 10;

/** Every recorded service for the vehicle in the selected period — date, cost, workshop, who logged it. */
export function VehicleServiceHistory({ vehicleId, period }: { vehicleId: string; period: FleetPeriod }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [period.dateFrom, period.dateTo]);

  const { data, isLoading, isFetching } = useServiceRecords({
    vehicleId,
    page,
    limit: PAGE_SIZE,
    dateFrom: period.dateFrom,
    dateTo: period.dateTo,
  });
  const { data: types } = useServiceTypes();
  const labelByKey = useMemo(() => new Map((types ?? []).map((t) => [t.key, t.label])), [types]);
  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Service History</h3>
        {data?.summary && (
          <p className="text-sm text-muted-foreground">
            {data.summary.count} service(s) · <span className="font-bold text-foreground">{fmtMoney(data.summary.totalCost)}</span>
          </p>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-24 rounded-2xl" />
      ) : !data?.data.length ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">No services recorded in this period.</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.data.map((r) => (
            <Card key={r.id} className="rounded-2xl">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Wrench className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="font-semibold text-sm">{labelByKey.get(r.serviceType) ?? r.serviceType.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(r.performedAtDate)}</p>
                    </div>
                  </div>
                  <p className="font-black tabular-nums">{fmtMoney(r.cost)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Gauge className="h-3.5 w-3.5" />
                    at <span className="font-medium text-foreground tabular-nums">{r.performedAtOdometer.toLocaleString()} km</span>
                  </span>
                  {r.workshopName && (
                    <span className="inline-flex items-center gap-1">
                      <Store className="h-3.5 w-3.5" />
                      {r.workshopName}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <UserIcon className="h-3.5 w-3.5" />
                    Recorded by <span className="font-medium text-foreground">{r.recordedBy.name}</span>
                  </span>
                </div>
                {(r.partsReplaced || r.notes) && (
                  <p className="text-xs text-muted-foreground">
                    {r.partsReplaced ? `Parts: ${r.partsReplaced}` : ''}
                    {r.partsReplaced && r.notes ? ' · ' : ''}
                    {r.notes ? `Note: ${r.notes}` : ''}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="rounded-xl gap-1" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> Newer
            </Button>
            <Button variant="outline" size="sm" className="rounded-xl gap-1" disabled={page >= totalPages || isFetching} onClick={() => setPage((p) => p + 1)}>
              Older <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
