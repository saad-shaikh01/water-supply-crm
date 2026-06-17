'use client';

import { Suspense } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { useTheme } from 'next-themes';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import {
  Card, CardContent, CardHeader, CardTitle,
  Skeleton,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@water-supply-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../../../components/shared/page-header';
import { DateRangePicker } from '../../../../components/shared/date-range-picker';
import { useWarehouseSummary } from '../../../../features/warehouse/hooks/use-warehouse';
import { productsApi } from '../../../../features/products/api/products.api';

function WarehouseSummaryContent() {
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));
  const [groupBy, setGroupBy] = useQueryState('groupBy', parseAsString.withDefault('month'));
  const [productId, setProductId] = useQueryState('productId', parseAsString.withDefault(''));

  const { data: summary, isLoading } = useWarehouseSummary({
    groupBy: (groupBy as 'week' | 'month') || 'month',
    productId: productId || undefined,
    dateFrom: from || undefined,
    dateTo: to || undefined,
  });

  const { data: products } = useQuery({
    queryKey: ['warehouse-summary-products-select'],
    queryFn: () => productsApi.getAll({ page: 1, limit: 100, isActive: true }).then((r) => r.data?.data ?? r.data?.items ?? r.data),
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

  const productList: { id: string; name: string }[] = Array.isArray(products) ? products : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouse Summary"
        description="Weekly and monthly bottle flow history"
      />

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 bg-card/30 p-3 sm:p-4 rounded-2xl border border-border">
        {/* GroupBy select */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Group By</span>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="h-9 sm:h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 pr-8 outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer min-w-[120px]"
          >
            <option value="month" className="bg-background text-foreground dark:text-white">Monthly</option>
            <option value="week" className="bg-background text-foreground dark:text-white">Weekly</option>
          </select>
        </div>

        {/* Product select */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Product</span>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value || null)}
            className="h-9 sm:h-10 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground dark:text-white px-3 pr-8 outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer min-w-[140px]"
          >
            <option value="" className="bg-background text-foreground dark:text-white">All Products</option>
            {productList.map((p) => (
              <option key={p.id} value={p.id} className="bg-background text-foreground dark:text-white">
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* DateRangePicker */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Date Range</span>
          <DateRangePicker />
        </div>
      </div>

      {/* Bar chart */}
      <Card className="border border-border/50 bg-card/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Bottle Flow — {groupBy === 'week' ? 'Weekly' : 'Monthly'} View
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full rounded-2xl" />
          ) : !summary?.rows.length ? (
            <div className="h-[300px] flex items-center justify-center text-sm text-muted-foreground">
              No data for the selected period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={summary.rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: isDark ? '#888' : '#666' }} />
                <YAxis tick={{ fontSize: 11, fill: isDark ? '#888' : '#666' }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="filledIn" name="Filled In" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sentToVans" name="Sent to Vans" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="returnedFilled" name="Returned Filled" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="refilled" name="Refilled" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="emptiesCollected" name="Empties Collected" fill="#6b7280" radius={[4, 4, 0, 0]} />
                <Bar dataKey="damagedTotal" name="Damaged" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="leakedTotal" name="Leaked" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Summary table */}
      <Card className="border border-border/50 bg-white/[0.02] backdrop-blur-2xl overflow-hidden shadow-2xl rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Period Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-xl" />
              ))}
            </div>
          ) : !summary?.rows.length ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No data for the selected period
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-white/[0.01] hover:bg-white/[0.01] border-b border-border">
                    {[
                      'Period',
                      'Filled In',
                      'Sent to Vans',
                      'Returned Filled',
                      'Refilled',
                      'Empties Collected',
                      'Damaged',
                      'Leaked',
                      'Sent for Repair',
                      'Returned from Repair',
                      'Written Off',
                    ].map((h) => (
                      <TableHead
                        key={h}
                        className="h-12 text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground whitespace-nowrap px-4"
                      >
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.rows.map((row, i) => (
                    <TableRow
                      key={row.period}
                      className={`border-b border-border/50 last:border-0 transition-colors hover:bg-white/[0.04] ${
                        i % 2 === 1 ? 'bg-white/[0.01]' : ''
                      }`}
                    >
                      <TableCell className="py-3 px-4 font-mono text-sm font-semibold text-foreground/90">
                        {row.period}
                      </TableCell>
                      <TableCell className="py-3 px-4 text-sm tabular-nums text-blue-500 font-semibold">
                        {row.filledIn}
                      </TableCell>
                      <TableCell className="py-3 px-4 text-sm tabular-nums text-indigo-500 font-semibold">
                        {row.sentToVans}
                      </TableCell>
                      <TableCell className="py-3 px-4 text-sm tabular-nums text-teal-500 font-semibold">
                        {row.returnedFilled}
                      </TableCell>
                      <TableCell className="py-3 px-4 text-sm tabular-nums text-emerald-500 font-semibold">
                        {row.refilled}
                      </TableCell>
                      <TableCell className="py-3 px-4 text-sm tabular-nums text-muted-foreground font-semibold">
                        {row.emptiesCollected}
                      </TableCell>
                      <TableCell className="py-3 px-4 text-sm tabular-nums text-amber-500 font-semibold">
                        {row.damagedTotal}
                      </TableCell>
                      <TableCell className="py-3 px-4 text-sm tabular-nums text-rose-500 font-semibold">
                        {row.leakedTotal}
                      </TableCell>
                      <TableCell className="py-3 px-4 text-sm tabular-nums text-purple-500 font-semibold">
                        {row.sentForRepair}
                      </TableCell>
                      <TableCell className="py-3 px-4 text-sm tabular-nums text-cyan-500 font-semibold">
                        {row.returnedFromRepair}
                      </TableCell>
                      <TableCell className="py-3 px-4 text-sm tabular-nums text-destructive font-semibold">
                        {row.writtenOff}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {summary.totals && (
                  <tfoot>
                    <TableRow className="border-t-2 border-primary/20 bg-primary/5 hover:bg-primary/5">
                      <TableCell className="py-4 px-4 text-sm font-black uppercase tracking-widest text-foreground">
                        Total
                      </TableCell>
                      <TableCell className="py-4 px-4 text-sm tabular-nums text-blue-500 font-black">
                        {summary.totals.filledIn}
                      </TableCell>
                      <TableCell className="py-4 px-4 text-sm tabular-nums text-indigo-500 font-black">
                        {summary.totals.sentToVans}
                      </TableCell>
                      <TableCell className="py-4 px-4 text-sm tabular-nums text-teal-500 font-black">
                        {summary.totals.returnedFilled}
                      </TableCell>
                      <TableCell className="py-4 px-4 text-sm tabular-nums text-emerald-500 font-black">
                        {summary.totals.refilled}
                      </TableCell>
                      <TableCell className="py-4 px-4 text-sm tabular-nums text-muted-foreground font-black">
                        {summary.totals.emptiesCollected}
                      </TableCell>
                      <TableCell className="py-4 px-4 text-sm tabular-nums text-amber-500 font-black">
                        {summary.totals.damagedTotal}
                      </TableCell>
                      <TableCell className="py-4 px-4 text-sm tabular-nums text-rose-500 font-black">
                        {summary.totals.leakedTotal}
                      </TableCell>
                      <TableCell className="py-4 px-4 text-sm tabular-nums text-purple-500 font-black">
                        {summary.totals.sentForRepair}
                      </TableCell>
                      <TableCell className="py-4 px-4 text-sm tabular-nums text-cyan-500 font-black">
                        {summary.totals.returnedFromRepair}
                      </TableCell>
                      <TableCell className="py-4 px-4 text-sm tabular-nums text-destructive font-black">
                        {summary.totals.writtenOff}
                      </TableCell>
                    </TableRow>
                  </tfoot>
                )}
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function WarehouseSummaryPage() {
  return (
    <Suspense>
      <WarehouseSummaryContent />
    </Suspense>
  );
}
