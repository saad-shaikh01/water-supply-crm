'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, Calendar, MapPin, User, Truck, SlidersHorizontal, Droplets, DollarSign, AlertTriangle, Zap } from 'lucide-react';
import {
  Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { RouteFilter } from '../../../components/shared/filters/route-filter';
import { VanFilter } from '../../../components/shared/filters/van-filter';
import { DriverFilter } from '../../../components/shared/filters/driver-filter';
import { useDailySheets } from '../hooks/use-daily-sheets';
import { useQueryState, parseAsString } from 'nuqs';
import { useAuthStore } from '../../../store/auth.store';
import { cn } from '@water-supply-crm/ui';

export function SheetList() {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, page, setPage, limit, setLimit, routeId, vanId, driverId } = useDailySheets();
  const [isClosed, setIsClosed] = useQueryState('isClosed', parseAsString.withDefault(''));
  const [filtersOpen, setFiltersOpen] = useState(false);

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
    itemCounts?: { pending: number; completed: number; issues: number };
    tripState?: { tripCount: number; hasActiveTrip: boolean };
    issueCount?: number;
    onDemandCount?: number;
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

  const resetPage = () => setPage(1);

  // Build active chip list for secondary filters
  const activeChips = [
    routeId ? { label: `Route`, clear: () => { resetPage(); } } : null,
    vanId ? { label: `Van`, clear: () => { resetPage(); } } : null,
    (!isDriver && driverId) ? { label: `Driver`, clear: () => { resetPage(); } } : null,
    isClosed ? { label: isClosed === 'true' ? 'Closed' : 'Open', clear: () => { resetPage(); setIsClosed(null); } } : null,
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

  return (
    <div className="space-y-4">
      {/* Primary filter bar */}
      <div className="flex flex-col sm:flex-row items-end gap-3 bg-card/30 p-4 rounded-2xl border border-border">
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Date Range</Label>
          <DateRangePicker />
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground ml-1">Status</Label>
          <Select value={isClosed || 'all'} onValueChange={(v) => { resetPage(); setIsClosed(v === 'all' ? null : v); }}>
            <SelectTrigger className="rounded-xl bg-background/50 border-border h-10 w-[130px]">
              <SelectValue placeholder="All Sheets" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border shadow-2xl">
              <SelectItem value="all">All Sheets</SelectItem>
              <SelectItem value="false">Open</SelectItem>
              <SelectItem value="true">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiltersOpen(true)}
          className={cn(
            "rounded-xl h-10 px-4 gap-2 font-semibold shrink-0",
            (routeId || vanId || (!isDriver && driverId)) && "border-primary text-primary"
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {(routeId || vanId || (!isDriver && driverId)) && (
            <span className="h-5 w-5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-black">
              {[routeId, vanId, (!isDriver && driverId) ? driverId : null].filter(Boolean).length}
            </span>
          )}
        </Button>
      </div>

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {activeChips.map((chip) => (
            <span
              key={chip.label}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold"
            >
              {chip.label}
            </span>
          ))}
          <button
            onClick={() => { resetPage(); setIsClosed(null); }}
            className="text-xs text-muted-foreground hover:text-foreground font-semibold underline-offset-2 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {!isDriver && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" asChild className="rounded-xl gap-2">
            <Link href="/dashboard/delivery-issues">
              <AlertTriangle className="h-4 w-4" />
              Delivery Issues Inbox
            </Link>
          </Button>
        </div>
      )}

      {/* More Filters drawer */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm bg-background/95 backdrop-blur-xl border-l border-border">
          <SheetHeader className="pb-6 border-b border-border">
            <SheetTitle className="flex items-center gap-2 text-lg font-bold">
              <SlidersHorizontal className="h-5 w-5 text-primary" /> More Filters
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-6 py-6">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Route</Label>
              <RouteFilter onBeforeChange={resetPage} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Van</Label>
              <VanFilter onBeforeChange={resetPage} />
            </div>
            {!isDriver && (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Driver</Label>
                <DriverFilter onBeforeChange={resetPage} />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

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
            header: 'Date',
            cell: (r) => (
              <div className="flex items-center gap-2 whitespace-nowrap">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 border border-primary/10">
                  <Calendar className="h-4 w-4" />
                </div>
                <span className="font-bold text-sm text-white">
                  {new Date(r.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                </span>
              </div>
            )
          },
          {
            key: 'route',
            header: 'Route & Van',
            cell: (r) => (
              <div className="flex flex-col min-w-0 max-w-[150px]">
                <div className="flex items-center gap-1.5 text-xs font-bold text-white truncate">
                  <MapPin className="h-3 w-3 text-primary shrink-0" />
                  {r.route?.name ?? '—'}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono truncate">
                  <Truck className="h-2.5 w-2.5 shrink-0" />
                  {r.van?.plateNumber ?? '—'}
                </div>
              </div>
            )
          },
          {
            key: 'driver',
            header: 'Driver',
            cell: (r) => (
              <div className="flex items-center gap-2 whitespace-nowrap max-w-[120px]">
                <div className="h-6 w-6 rounded-full bg-white/5 border border-white/5 flex items-center justify-center shrink-0">
                  <User className="h-3 w-3 text-muted-foreground/60" />
                </div>
                <span className="text-xs font-semibold text-white/80 truncate">{r.driver?.name ?? '—'}</span>
              </div>
            )
          },
          {
            key: 'items',
            header: 'Items',
            cell: (r) => {
              if (r.itemCounts) {
                const total = r.itemCounts.pending + r.itemCounts.completed + r.itemCounts.issues;
                return (
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className="text-xs font-bold text-white">{total}</span>
                    <div className="flex items-center gap-1.5 text-[10px] font-mono">
                      <span className="text-emerald-400">{r.itemCounts.completed}✓</span>
                      <span className="text-amber-400">{r.itemCounts.pending}⏳</span>
                      {r.itemCounts.issues > 0 && (
                        <span className="text-rose-400">{r.itemCounts.issues}!</span>
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <span className="text-xs font-bold text-white whitespace-nowrap">{r._count?.items ?? 0} Items</span>
              );
            }
          },
          {
            key: 'bottles',
            header: 'Bottles',
            cell: (r) => (
              <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                <span className="font-bold text-white">{r.filledOutCount ?? 0}</span>
                <span className="text-muted-foreground/40">/</span>
                <span className="font-bold text-white">{r.filledInCount ?? 0}</span>
                <span className="text-muted-foreground/40 font-medium">in</span>
              </div>
            )
          },
          {
            key: 'cash',
            header: 'Cash',
            cell: (r) => (
              <div className="text-xs font-mono font-bold text-emerald-400 whitespace-nowrap">
                ₨ {Number(r.cashCollected ?? 0).toLocaleString()}
              </div>
            )
          },
          {
            key: 'ops',
            header: 'Signals',
            cell: (r) => (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                {r.issueCount !== undefined && r.issueCount > 0 && (
                  <Badge variant="outline" className="h-5 px-1.5 border-rose-500/20 bg-rose-500/10 text-rose-400 text-[9px] font-bold">
                    {r.issueCount} ERR
                  </Badge>
                )}
                {r.onDemandCount !== undefined && r.onDemandCount > 0 && (
                  <Badge variant="outline" className="h-5 px-1.5 border-indigo-500/20 bg-indigo-500/10 text-indigo-400 text-[9px] font-bold">
                    {r.onDemandCount} REQ
                  </Badge>
                )}
              </div>
            )
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <div className="scale-90 origin-left">
                <StatusBadge status={getStatus(r)} />
              </div>
            )
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
