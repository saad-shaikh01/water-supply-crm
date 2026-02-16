'use client';

import Link from 'next/link';
import { Eye, Calendar, MapPin, User, Truck, FileText } from 'lucide-react';
import { Button, Badge } from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { RouteFilter } from '../../../components/shared/filters/route-filter';
import { useDailySheets } from '../hooks/use-daily-sheets';
import { cn } from '@water-supply-crm/ui';

export function SheetList() {
  const { data, isLoading, page, setPage } = useDailySheets();

  const sheets = (data as { data?: unknown[]; totalPages?: number } | undefined);
  const rows = (sheets?.data ?? []) as Array<{ 
    id: string; 
    date: string; 
    isClosed: boolean; 
    filledOutCount: number;
    cashCollected: number;
    route?: { name: string }; 
    driver?: { name: string }; 
    van?: { plateNumber: string };
    _count?: { items: number };
  }>;
  const totalPages = sheets?.totalPages ?? 1;

  const getStatus = (sheet: typeof rows[0]) => {
    if (sheet.isClosed) return 'CLOSED';
    if (sheet.cashCollected > 0) return 'CHECKED_IN';
    if (sheet.filledOutCount > 0) return 'LOADED';
    return 'OPEN';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-card/30 p-4 rounded-2xl border border-border/50">
        <SearchInput placeholder="Search by date..." paramKey="date" />
        <RouteFilter />
      </div>

      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
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
