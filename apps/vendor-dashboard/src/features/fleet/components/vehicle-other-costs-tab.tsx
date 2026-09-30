'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Receipt, User as UserIcon, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, Badge, Button, Skeleton } from '@water-supply-crm/ui';
import { useVehicleOtherExpenses } from '../hooks/use-fleet';
import { fmtDate, fmtMoney } from '../lib/fleet-format';
import type { FleetPeriod } from './fleet-period-picker';

const PAGE_SIZE = 20;

/** Non-fuel, non-maintenance expenses (police, vehicle rent, misc.) booked on sheets this vehicle ran. */
export function VehicleOtherCostsTab({ vehicleId, period }: { vehicleId: string; period: FleetPeriod }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [period.dateFrom, period.dateTo]);

  const { data, isLoading, isFetching } = useVehicleOtherExpenses(vehicleId, {
    dateFrom: period.dateFrom,
    dateTo: period.dateTo,
    page,
    limit: PAGE_SIZE,
  });
  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Expenses (police, vehicle rent, other) entered on daily sheets this vehicle ran. Fuel and maintenance are counted in their own tabs.
        </p>
        {data?.summary && (
          <p className="text-sm text-muted-foreground">
            {data.meta.total} expense(s) · <span className="font-bold text-foreground">{fmtMoney(data.summary.totalAmount)}</span>
          </p>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-24 rounded-2xl" />
      ) : !data?.data.length ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">No other costs in this period.</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.data.map((e) => (
            <Card key={e.id} className="rounded-2xl">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Receipt className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="font-semibold text-sm">
                        {e.category.replace(/_/g, ' ')}
                        {!e.paidFromCash && <Badge variant="outline" className="ml-2 text-[11px]">Not from van cash</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">{e.description} · {fmtDate(e.date)}</p>
                    </div>
                  </div>
                  <p className="font-black tabular-nums">{fmtMoney(e.amount)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <UserIcon className="h-3.5 w-3.5" />
                    Recorded by <span className="font-medium text-foreground">{e.createdBy.name}</span>
                  </span>
                  {e.dailySheet && (
                    <Link href={`/dashboard/daily-sheets/${e.dailySheet.id}`} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
                      {e.dailySheet.van.plateNumber} · {fmtDate(e.dailySheet.date)}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
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
