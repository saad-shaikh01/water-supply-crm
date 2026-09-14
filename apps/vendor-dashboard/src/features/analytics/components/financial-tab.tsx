'use client';

import {
  Card, CardContent, CardHeader, CardTitle, Skeleton,
} from '@water-supply-crm/ui';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { useTheme } from 'next-themes';
import { useFinancialAnalytics } from '../hooks/use-analytics';
import {
  TrendingUp, TrendingDown, DollarSign, Percent, Landmark, Wallet, Clock, Store, ArrowUpRight, ArrowDownRight,
  Users, ShieldAlert,
} from 'lucide-react';
import { cn } from '@water-supply-crm/ui';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function fmt(n: number) {
  return `₨${n.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

/** Small "+12% vs last period" chip — green for good news, red for bad, flips for expenses (a rise is bad there). */
function DeltaChip({ pct, invert }: { pct: number | null; invert?: boolean }) {
  if (pct === null) return null;
  const isGood = invert ? pct <= 0 : pct >= 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-bold', isGood ? 'text-emerald-500' : 'text-destructive')}>
      {pct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(pct)}% vs last period
    </span>
  );
}

function StatCard({
  label, value, icon: Icon, positive, deltaPct, deltaInvert, sublabel,
}: {
  label: string; value: string; icon: any; positive?: boolean; deltaPct?: number | null; deltaInvert?: boolean; sublabel?: string;
}) {
  return (
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold">{label}</p>
            <p className={`text-xl font-bold mt-0.5 ${positive === false ? 'text-destructive' : ''}`}>{value}</p>
            {deltaPct !== undefined && <DeltaChip pct={deltaPct} invert={deltaInvert} />}
            {sublabel && <p className="text-[11px] text-muted-foreground mt-0.5">{sublabel}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function FinancialTab({ from, to, vanId }: { from: string; to: string; vanId?: string }) {
  const { data, isLoading } = useFinancialAnalytics(from, to, vanId);
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

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-[2rem]" />)}
        </div>
        <Skeleton className="h-[300px] w-full rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[300px] rounded-2xl" />
          <Skeleton className="h-[300px] rounded-2xl" />
        </div>
      </div>
    );
  }

  const d = data as any;
  if (!d) return null;

  const revenue = d.revenue?.total ?? 0;
  const expenses = d.expenses?.total ?? 0;
  const profit = d.profit?.total ?? 0;
  const profitMargin = d.profitMargin ?? 0;
  const collectionRate = d.collectionRate ?? 0;
  const momGrowth = d.momGrowth as { revenueChangePct: number | null; profitChangePct: number | null } | null;
  const payrollCost = d.payrollCost ?? 0;
  const netProfit = d.netProfit ?? profit;
  const netProfitMargin = d.netProfitMargin ?? profitMargin;
  const discrepancyWriteOff = d.discrepancyWriteOff ?? { total: 0, details: [] };
  const revenueByProduct = d.revenueByProduct ?? [];

  const profitByDay = (d.profit?.byDay ?? []).map((p: any) => ({
    date: p.date.slice(5), // MM-DD
    Revenue: p.revenue,
    Expenses: p.expenses,
    Profit: p.profit,
  }));

  const expensesByCategory = d.expenses?.byCategory ?? [];
  const revenueByRoute = (d.revenueByRoute ?? []).slice(0, 8);
  const { CASH = 0, MONTHLY = 0 } = d.revenueByPaymentType ?? {};

  const vanBreakdown = d.cashByVan ?? [];
  const walkInCash = d.walkInCash ?? { collected: 0, expected: 0, sheetCount: 0 };
  const officeCash = d.officeCash ?? {
    scope: 'OFFICE', available: 0, periodExpense: 0, periodCashIn: 0, periodRemitted: 0, pendingHandoverCount: 0, pendingRemittanceCount: 0,
  };
  // A single van is already selected — the per-van table below would just
  // repeat that one row, so it's skipped in favor of the summary cards above.
  const isVanScoped = !!vanId;
  const cashLabel = isVanScoped ? 'Van Cash on Hand' : 'Office Cash Available';
  const cashSublabel = isVanScoped ? 'not yet handed to office' : 'as of now';

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total Revenue" value={fmt(revenue)} icon={TrendingUp} deltaPct={momGrowth?.revenueChangePct} />
        <StatCard label="Total Expenses" value={fmt(expenses)} icon={TrendingDown} positive={false} />
        <StatCard label="Gross Profit" value={fmt(profit)} icon={DollarSign} positive={profit >= 0} deltaPct={momGrowth?.profitChangePct} />
        <StatCard label="Profit Margin" value={`${profitMargin}%`} icon={Percent} positive={profitMargin >= 0} />
        <StatCard label="Collection Rate" value={`${collectionRate}%`} icon={Percent} />
      </div>

      {/* Net Profit — Gross Profit above is pre-payroll (Total Expenses never
          included staff salaries); this row is the truer bottom line. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Payroll Cost" value={fmt(payrollCost)} icon={Users} positive={false} sublabel="approved + settled" />
        <StatCard label="Net Profit (after payroll)" value={fmt(netProfit)} icon={DollarSign} positive={netProfit >= 0} />
        <StatCard label="Net Profit Margin" value={`${netProfitMargin}%`} icon={Percent} positive={netProfitMargin >= 0} />
      </div>

      {/* Revenue vs Expenses area chart */}
      <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Revenue vs Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          {profitByDay.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No data for selected period</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={profitByDay}>
                <defs>
                  <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradExpenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="date" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `₨${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmt(v)} />
                <Legend />
                <Area type="monotone" dataKey="Revenue" stroke="#3b82f6" fill="url(#gradRevenue)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="Expenses" stroke="#ef4444" fill="url(#gradExpenses)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Expenses by category */}
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Expenses by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {expensesByCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No expense data</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={expensesByCategory} dataKey="amount" nameKey="category" cx="50%" cy="50%" innerRadius={70} outerRadius={110} paddingAngle={3}>
                    {expensesByCategory.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmt(v)} />
                  <Legend formatter={(v) => v.toLowerCase()} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Revenue by route */}
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Revenue by Route</CardTitle>
          </CardHeader>
          <CardContent>
            {revenueByRoute.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No route data</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={revenueByRoute} layout="vertical" margin={{ left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                  <XAxis type="number" stroke="#888" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `₨${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="routeName" stroke="#888" fontSize={11} tickLine={false} axisLine={false} width={80} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmt(v)} />
                  <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revenue by product — only worth a chart when there's more than one */}
      {revenueByProduct.length > 1 && (
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Revenue by Product</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(180, revenueByProduct.length * 44)}>
              <BarChart data={revenueByProduct} layout="vertical" margin={{ left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                <XAxis type="number" stroke="#888" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `₨${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="productName" stroke="#888" fontSize={11} tickLine={false} axisLine={false} width={100} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: string) => (name === 'revenue' ? fmt(v) : v)} />
                <Bar dataKey="revenue" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={18} name="revenue" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Payment type split */}
      <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Revenue by Payment Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-12">
            <div className="text-center">
              <p className="text-3xl font-bold text-blue-500">{fmt(CASH)}</p>
              <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest font-bold">Cash</p>
            </div>
            <div className="h-16 w-px bg-border" />
            <div className="text-center">
              <p className="text-3xl font-bold text-emerald-500">{fmt(MONTHLY)}</p>
              <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest font-bold">Monthly</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cash Ledger snapshot — office/van cash on hand right now, plus walk-in's contribution */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={cashLabel} value={fmt(officeCash.available)} icon={Landmark} sublabel={cashSublabel} />
        <StatCard label="Cash Ledger Expense" value={fmt(officeCash.periodExpense)} icon={Wallet} positive={false} sublabel="this period" />
        <StatCard label="Pending Handovers" value={String(officeCash.pendingHandoverCount)} icon={Clock} sublabel="awaiting office approval" />
        {!isVanScoped && (
          <StatCard label="Walk-in Cash Collected" value={fmt(walkInCash.collected)} icon={Store} sublabel={`${walkInCash.sheetCount} walk-in day(s)`} />
        )}
      </div>

      {/* Discrepancy write-offs — cash/bottle/empty shortfalls resolved as a
          company loss (distinct from the Customers tab's Force-Deactivate
          write-offs — this is route/driver shrinkage, not a customer's debt). */}
      <div className="grid gap-4 sm:grid-cols-1">
        <StatCard label="Discrepancy Write-offs" value={fmt(discrepancyWriteOff.total)} icon={ShieldAlert} positive={discrepancyWriteOff.total <= 0} sublabel="cash/bottle shortfalls written off this period" />
      </div>
      {discrepancyWriteOff.details.length > 0 && (
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Discrepancy Write-off Detail</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground uppercase tracking-widest border-b border-border/50">
                    <th className="pb-3 pr-4">Date</th>
                    <th className="pb-3 pr-4">Van</th>
                    <th className="pb-3 pr-4">Driver</th>
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {discrepancyWriteOff.details.map((row: any) => (
                    <tr key={row.id} className="border-b border-border/30 hover:bg-accent/20 transition-colors">
                      <td className="py-3 pr-4 text-xs text-muted-foreground">{new Date(row.date).toLocaleDateString()}</td>
                      <td className="py-3 pr-4 font-semibold">{row.vanPlateNumber}</td>
                      <td className="py-3 pr-4">{row.driverName}</td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground capitalize">{row.type.toLowerCase()}</td>
                      <td className="py-3 text-right font-mono">{fmt(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Van-wise breakdown — skipped when one van is already selected, since
          it would just repeat the summary cards above as a single row. */}
      {!isVanScoped && (
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Van-wise Cash &amp; Expense Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {vanBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No van data for selected period</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground uppercase tracking-widest border-b border-border/50">
                      <th className="pb-3 pr-4">Van</th>
                      <th className="pb-3 pr-4 text-right">Collected</th>
                      <th className="pb-3 pr-4 text-right">Expected</th>
                      <th className="pb-3 pr-4 text-right">Pending</th>
                      <th className="pb-3 pr-4 text-right">Expenses</th>
                      <th className="pb-3 text-right">Crew Cash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vanBreakdown.map((v: any) => (
                      <tr key={v.vanId} className="border-b border-border/30 hover:bg-accent/20 transition-colors">
                        <td className="py-3 pr-4 font-semibold">{v.plateNumber}</td>
                        <td className="py-3 pr-4 text-right font-mono text-emerald-500">{fmt(v.cashCollected)}</td>
                        <td className="py-3 pr-4 text-right font-mono text-muted-foreground">{fmt(v.cashExpected)}</td>
                        <td className={cn('py-3 pr-4 text-right font-mono', v.pending > 0 && 'text-amber-500')}>{fmt(v.pending)}</td>
                        <td className="py-3 pr-4 text-right font-mono text-destructive">{fmt(v.expenses)}</td>
                        <td className="py-3 text-right font-mono">{fmt(v.crewCash)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
