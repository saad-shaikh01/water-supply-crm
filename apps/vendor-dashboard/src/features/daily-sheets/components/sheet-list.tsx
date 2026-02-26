'use client';

import Link from 'next/link';
import { Eye, Calendar, MapPin, User, Truck } from 'lucide-react';
import { Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { RouteFilter } from '../../../components/shared/filters/route-filter';
import { VanFilter } from '../../../components/shared/filters/van-filter';
import { DriverFilter } from '../../../components/shared/filters/driver-filter';
import { useDailySheets } from '../hooks/use-daily-sheets';
import { useQueryState, parseAsString } from 'nuqs';
import { useAuthStore } from '../../../store/auth.store';

export function SheetList() {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, page, setPage, limit, setLimit } = useDailySheets();
  const [isClosed, setIsClosed] = useQueryState('isClosed', parseAsString.withDefault(''));

  const sheets = (data as { data?: unknown[]; meta?: { total: number } } | undefined);
  const rows = (sheets?.data ?? []) as Array<{
    id: string;
    date: string;
    isClosed: boolean;
    filledOutCount: number;
    filledInCount: number;
    emptyInCount: number;
    cashCollected: number;
    route?: { name: string };
    driver?: { name: string };
    van?: { plateNumber: string };
    _count?: { items: number };
  }>;
  const total = sheets?.meta?.total ?? 0;

  const getStatus = (sheet: typeof rows[0]) => {
    if (sheet.isClosed) return 'CLOSED';
    // Checked-in: any return indicators present (cash, bottles back, or empties collected)
    if (sheet.cashCollected > 0 || sheet.filledInCount > 0 || sheet.emptyInCount > 0) return 'CHECKED_IN';
    if (sheet.filledOutCount > 0) return 'LOADED';
    return 'OPEN';
  };

  const isDriver = user?.role === 'DRIVER';

  return (
    <div className="space-y-6">
      <div className="bg-card/30 p-6 rounded-2xl border border-border/50 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Date range picker — single dropdown */}
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Date Range</Label>
            <DateRangePicker />
          </div>

          {/* Status filter */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Status</Label>
            <Select value={isClosed || 'all'} onValueChange={(v) => setIsClosed(v === 'all' ? null : v)}>
              <SelectTrigger className="rounded-xl bg-background/50 border-border/50 h-10">
                <SelectValue placeholder="All Sheets" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-border/50 shadow-2xl">
                <SelectItem value="all">All Sheets</SelectItem>
                <SelectItem value="false">Open</SelectItem>
                <SelectItem value="true">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Route */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Route</Label>
            <RouteFilter />
          </div>

          {/* Van */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Van</Label>
            <VanFilter />
          </div>

          {/* Driver — hidden for drivers */}
          {!isDriver && (
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Driver</Label>
              <DriverFilter />
            </div>
          )}
        </div>
      </div>

      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
        emptyMessage="No sheets found for this selection."
        columns={[
          {
            key: 'date',
            header: 'Operations Date',
            cell: (r) => (
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0 border border-primary/10">
                  <Calendar className="h-5 w-5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold truncate text-sm">
                    {new Date(r.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">
                    {new Date(r.date).getFullYear()}
                  </span>
                </div>
              </div>
            )
          },
          {
            key: 'route',
            header: 'Route & Van',
            cell: (r) => (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-sm font-bold">
                  <MapPin className="h-3 w-3 text-primary" />
                  {r.route?.name ?? '—'}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
                  <Truck className="h-2.5 w-2.5" />
                  {r.van?.plateNumber ?? '—'}
                </div>
              </div>
            )
          },
          {
            key: 'driver',
            header: 'Driver',
            cell: (r) => (
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-accent flex items-center justify-center">
                  <User className="h-3 w-3 text-muted-foreground" />
                </div>
                <span className="text-xs font-semibold">{r.driver?.name ?? '—'}</span>
              </div>
            )
          },
          {
            key: 'items',
            header: 'Load',
            cell: (r) => (
              <div className="flex flex-col">
                <span className="text-sm font-bold">{r._count?.items ?? 0} Items</span>
                <span className="text-[10px] text-muted-foreground">Planned Deliveries</span>
              </div>
            )
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => <StatusBadge status={getStatus(r)} />
          },
          {
            key: 'actions',
            header: '',
            width: '60px',
            cell: (r) => (
              <Button variant="ghost" size="icon" asChild className="hover:bg-primary/10 hover:text-primary rounded-full transition-all">
                <Link href={`/dashboard/daily-sheets/${r.id}`}>
                  <Eye className="h-4 w-4" />
                </Link>
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
