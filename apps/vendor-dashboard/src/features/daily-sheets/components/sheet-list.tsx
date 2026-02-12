'use client';

import Link from 'next/link';
import { Eye } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { DataTable } from '../../../components/shared/data-table';
import { StatusBadge } from '../../../components/shared/status-badge';
import { SearchInput } from '../../../components/shared/filters/search-input';
import { useDailySheets } from '../hooks/use-daily-sheets';

export function SheetList() {
  const { data, isLoading, page } = useDailySheets();

  const sheets = (data as { data?: unknown[]; totalPages?: number } | undefined);
  const rows = (sheets?.data ?? []) as Array<{ id: string; date: string; status: string; route?: { name: string }; driver?: { name: string }; van?: { plateNumber: string } }>;
  const totalPages = sheets?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SearchInput placeholder="Search sheets..." paramKey="date" />
      </div>
      <DataTable
        data={rows}
        isLoading={isLoading}
        page={page}
        totalPages={totalPages}
        emptyMessage="No daily sheets found"
        columns={[
          { key: 'date', header: 'Date', cell: (r) => new Date(r.date).toLocaleDateString() },
          { key: 'route', header: 'Route', cell: (r) => r.route?.name ?? '—' },
          { key: 'driver', header: 'Driver', cell: (r) => r.driver?.name ?? '—' },
          { key: 'van', header: 'Van', cell: (r) => r.van?.plateNumber ?? '—' },
          { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          {
            key: 'actions', header: '', width: '60px',
            cell: (r) => (
              <Button variant="ghost" size="icon" asChild>
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
