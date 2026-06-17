'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, Button } from '@water-supply-crm/ui';
import { PageHeader } from '../../../../components/shared/page-header';
import { useWarehouseSummary } from '../../../../features/warehouse/hooks/use-warehouse';
import { productsApi } from '../../../../features/products/api/products.api';

export default function WarehouseSummaryPage() {
  const [groupBy, setGroupBy] = useState<'week' | 'month'>('month');
  const [productId, setProductId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: summary, isLoading } = useWarehouseSummary({
    groupBy,
    productId: productId || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: () => productsApi.getAll({}).then((r: any) => r.data?.data ?? r.data),
  });

  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const gridColor = isDark ? '#333' : '#eee';
  const tooltipStyle = {
    backgroundColor: isDark ? '#18181b' : '#ffffff',
    border: '1px solid rgba(128,128,128,0.2)',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'bold',
    color: isDark ? '#fff' : '#111',
  };

  const chartData = (summary?.rows ?? []).map((row) => ({
    period: row.period,
    'Filled In': row.filledIn,
    'Sent to Vans': row.sentToVans,
    'Returned': row.returnedFilled,
    'Refilled': row.refilled,
    'Empties Collected': row.emptiesCollected,
    'Damaged': row.damagedTotal,
    'Leaked': row.leakedTotal,
  }));

  const tableColumns = [
    { key: 'period', label: 'Period' },
    { key: 'filledIn', label: 'Filled In' },
    { key: 'sentToVans', label: 'Sent to Vans' },
    { key: 'returnedFilled', label: 'Returned Filled' },
    { key: 'refilled', label: 'Refilled' },
    { key: 'emptiesCollected', label: 'Empties Collected' },
    { key: 'damagedTotal', label: 'Damaged' },
    { key: 'leakedTotal', label: 'Leaked' },
    { key: 'sentForRepair', label: 'Sent for Repair' },
    { key: 'returnedFromRepair', label: 'Returned from Repair' },
    { key: 'writtenOff', label: 'Written Off' },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouse Summary"
        description="Monthly and weekly bottle flow history"
      />

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* GroupBy toggle */}
        <div className="flex rounded-xl border border-border/50 overflow-hidden">
          <button
            type="button"
            onClick={() => setGroupBy('month')}
            className={`px-4 py-2 text-sm font-semibold transition-colors ${
              groupBy === 'month'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background/50 text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setGroupBy('week')}
            className={`px-4 py-2 text-sm font-semibold transition-colors ${
              groupBy === 'week'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background/50 text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            }`}
          >
            Weekly
          </button>
        </div>

        {/* Product filter */}
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="h-10 px-3 rounded-xl border border-border/50 bg-background/50 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
        >
          <option value="">All Products</option>
          {Array.isArray(products) && products.map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* Date From */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest px-1">From</label>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 px-3 rounded-xl border border-border/50 bg-background/50 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
          />
        </div>

        {/* Date To */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest px-1">To</label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-10 px-3 rounded-xl border border-border/50 bg-background/50 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
          />
        </div>

        {/* Clear filters */}
        {(productId || dateFrom || dateTo) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-10 rounded-xl text-xs font-bold"
            onClick={() => { setProductId(''); setDateFrom(''); setDateTo(''); }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Bar Chart */}
      <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Bottle Flow — {groupBy === 'month' ? 'Monthly' : 'Weekly'} View
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[320px] w-full rounded-2xl" />
          ) : chartData.length === 0 ? (
            <div className="flex items-center justify-center h-[320px]">
              <p className="text-sm text-muted-foreground">No data for the selected period</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="period" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Bar dataKey="Filled In" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Sent to Vans" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Returned" fill="#14b8a6" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Refilled" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Empties Collected" fill="#6b7280" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Damaged" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Leaked" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Summary Table */}
      <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Detailed Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-xl" />
              ))}
            </div>
          ) : (summary?.rows ?? []).length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">No data for the selected period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card/80 backdrop-blur-md">
                  <tr className="border-b border-border/50">
                    {tableColumns.map((col) => (
                      <th
                        key={col.key}
                        className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-muted-foreground whitespace-nowrap"
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(summary?.rows ?? []).map((row, i) => (
                    <tr
                      key={row.period}
                      className={`border-b border-border/30 transition-colors hover:bg-white/5 ${
                        i % 2 === 0 ? '' : 'bg-white/[0.01]'
                      }`}
                    >
                      {tableColumns.map((col) => (
                        <td
                          key={col.key}
                          className="px-4 py-3 text-foreground whitespace-nowrap"
                        >
                          {row[col.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {summary?.totals && (
                  <tfoot>
                    <tr className="border-t-2 border-primary/20 bg-primary/5">
                      {tableColumns.map((col) => (
                        <td
                          key={col.key}
                          className="px-4 py-3 font-bold text-foreground whitespace-nowrap"
                        >
                          {col.key === 'period' ? 'Totals' : summary.totals[col.key]}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
