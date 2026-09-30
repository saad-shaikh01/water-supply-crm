'use client';

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@water-supply-crm/ui';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { useTheme } from 'next-themes';
import { Route, CalendarDays, Fuel, Wrench, Receipt, Wallet, Gauge, Droplets, Tag, Clock3 } from 'lucide-react';
import { useVehiclePeriodSummary, useVehicleMonthlyReport } from '../hooks/use-fleet';
import { fmtDate, fmtKm, fmtMoney, fmtNum, monthLabel, monthToRange } from '../lib/fleet-format';
import type { FleetPeriod } from './fleet-period-picker';

const COLORS = { fuel: '#f97316', maintenance: '#3b82f6', other: '#a855f7' };

function Tile({ icon: Icon, label, value, hint }: { icon: typeof Route; label: string; value: string; hint?: string }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 flex items-start gap-3">
        <Icon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">{label}</p>
          <p className="text-lg font-black tabular-nums">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

interface VehicleStatsSectionProps {
  vehicleId: string;
  period: FleetPeriod;
  /** Clicking a month row in the month-wise table narrows the whole page to that month. */
  onSelectMonth: (dateFrom: string, dateTo: string) => void;
}

export function VehicleStatsSection({ vehicleId, period, onSelectMonth }: VehicleStatsSectionProps) {
  const { resolvedTheme } = useTheme();
  const gridColor = resolvedTheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const tooltipStyle = {
    background: resolvedTheme === 'dark' ? '#111' : '#fff',
    border: '1px solid rgba(128,128,128,0.25)',
    borderRadius: 12,
    fontSize: 12,
  };

  const { data: stats, isLoading } = useVehiclePeriodSummary(vehicleId, { dateFrom: period.dateFrom, dateTo: period.dateTo });
  const { data: monthly } = useVehicleMonthlyReport(vehicleId, 12);

  if (isLoading || !stats) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    );
  }

  const splitTotal = stats.totalCost || 1;
  const chartData = (monthly ?? []).map((m) => ({
    label: monthLabel(m.month, 'short'),
    Fuel: Math.round(m.fuelCost),
    Maintenance: Math.round(m.maintenanceCost),
    Other: Math.round(m.otherCost),
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile icon={Route} label="Km Driven" value={fmtKm(stats.kmDriven)} hint="From sheet start/end readings" />
        <Tile icon={CalendarDays} label="Days on Road" value={fmtNum(stats.daysUsed)} hint={stats.daysUsed ? `${fmtNum(stats.kmDriven / stats.daysUsed)} km/day avg` : undefined} />
        <Tile icon={Fuel} label="Fuel" value={fmtMoney(stats.fuelCost)} hint={`${fmtNum(stats.fuelLiters, 1)} L · ${stats.fuelFills} fill(s)`} />
        <Tile icon={Wrench} label="Maintenance" value={fmtMoney(stats.maintenanceCost)} hint={`${stats.serviceCount} service(s)`} />
        <Tile icon={Receipt} label="Other Costs" value={fmtMoney(stats.otherCost)} hint="Police, rent, misc. on its trips" />
        <Tile icon={Wallet} label="Total Cost" value={fmtMoney(stats.totalCost)} />
        <Tile icon={Gauge} label="Cost / km" value={stats.costPerKm != null ? `₨${fmtNum(stats.costPerKm, 1)}` : '—'} />
        <Tile icon={Droplets} label="Avg km / L" value={stats.avgKmPerLiter != null ? fmtNum(stats.avgKmPerLiter, 1) : '—'} />
        <Tile icon={Tag} label="Avg Fuel Price" value={stats.avgPricePerLiter != null ? `₨${fmtNum(stats.avgPricePerLiter, 1)}/L` : '—'} />
        <Tile icon={Clock3} label="Last Fill" value={stats.lastFuelAt ? fmtDate(stats.lastFuelAt) : '—'} />
      </div>

      {stats.totalCost > 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-4 space-y-2">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              <div style={{ width: `${(stats.fuelCost / splitTotal) * 100}%`, background: COLORS.fuel }} />
              <div style={{ width: `${(stats.maintenanceCost / splitTotal) * 100}%`, background: COLORS.maintenance }} />
              <div style={{ width: `${(stats.otherCost / splitTotal) * 100}%`, background: COLORS.other }} />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              {[
                ['Fuel', stats.fuelCost, COLORS.fuel],
                ['Maintenance', stats.maintenanceCost, COLORS.maintenance],
                ['Other', stats.otherCost, COLORS.other],
              ].map(([name, val, color]) => (
                <span key={name as string} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: color as string }} />
                  {name as string} {Math.round(((val as number) / splitTotal) * 100)}% · {fmtMoney(val as number)}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Month-wise (last 12 months)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="label" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMoney(Number(v ?? 0))} />
              <Legend />
              <Bar dataKey="Fuel" stackId="c" fill={COLORS.fuel} />
              <Bar dataKey="Maintenance" stackId="c" fill={COLORS.maintenance} />
              <Bar dataKey="Other" stackId="c" fill={COLORS.other} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                  {['Month', 'Km', 'Fuel', 'Litres', 'Maint.', 'Other', 'Total', 'Cost/km', 'km/L'].map((h, i) => (
                    <th key={h} className={`py-2 pr-3 font-semibold ${i > 0 ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...(monthly ?? [])].reverse().map((m) => (
                  <tr
                    key={m.month}
                    className="cursor-pointer border-t border-border/50 hover:bg-muted/40 tabular-nums"
                    onClick={() => {
                      const r = monthToRange(m.month);
                      onSelectMonth(r.dateFrom, r.dateTo);
                    }}
                  >
                    <td className="py-2 pr-3 font-semibold">{monthLabel(m.month)}</td>
                    <td className="py-2 pr-3 text-right">{fmtNum(m.kmDriven)}</td>
                    <td className="py-2 pr-3 text-right">{fmtMoney(m.fuelCost)}</td>
                    <td className="py-2 pr-3 text-right">{fmtNum(m.fuelLiters, 1)}</td>
                    <td className="py-2 pr-3 text-right">{fmtMoney(m.maintenanceCost)}</td>
                    <td className="py-2 pr-3 text-right">{fmtMoney(m.otherCost)}</td>
                    <td className="py-2 pr-3 text-right font-bold">{fmtMoney(m.totalCost)}</td>
                    <td className="py-2 pr-3 text-right">{m.costPerKm != null ? fmtNum(m.costPerKm, 1) : '—'}</td>
                    <td className="py-2 text-right">{m.avgKmPerLiter != null ? fmtNum(m.avgKmPerLiter, 1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Click a month to filter every tab to it.</p>
        </CardContent>
      </Card>
    </div>
  );
}
