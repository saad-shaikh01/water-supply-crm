'use client';

import {
  Card, CardContent, CardHeader, CardTitle, Skeleton,
} from '@water-supply-crm/ui';
import { useOperationsAnalytics } from '../hooks/use-analytics';
import {
  Fuel, Wrench, Gauge, Route, ShieldAlert, CheckCircle2, Droplets,
  LifeBuoy, Clock, MessageCircleMore, Send, SkipForward,
} from 'lucide-react';

function fmt(n: number) {
  return `₨${n.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

function StatCard({ label, value, icon: Icon, sublabel }: { label: string; value: string; icon: any; sublabel?: string }) {
  return (
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold">{label}</p>
            <p className="text-xl font-bold mt-0.5">{value}</p>
            {sublabel && <p className="text-[11px] text-muted-foreground mt-0.5">{sublabel}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-black uppercase tracking-widest text-muted-foreground pt-2">{children}</p>;
}

export function OperationsTab({ from, to, vanId }: { from: string; to: string; vanId?: string }) {
  const { data, isLoading } = useOperationsAnalytics(from, to, vanId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-[2rem]" />)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-[2rem]" />)}
        </div>
        <Skeleton className="h-[240px] w-full rounded-2xl" />
      </div>
    );
  }

  const d = data as any;
  if (!d) return null;

  const fleet = d.fleet ?? { totalFuelCost: 0, totalMaintenanceCost: 0, totalDistanceKm: 0, overallCostPerKm: null, byVan: [] };
  const damage = d.damage ?? { total: 0, open: 0, resolved: 0, totalBottles: 0, totalCharged: 0 };
  const supportTickets = d.supportTickets ?? { total: 0, open: 0, resolved: 0, avgResolutionHours: null };
  const reminders = d.reminders ?? { batches: 0, sent: 0, skipped: 0 };

  return (
    <div className="space-y-4">
      {/* Fleet */}
      <SectionTitle>Fleet — Fuel &amp; Maintenance</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Fuel Cost" value={fmt(fleet.totalFuelCost)} icon={Fuel} />
        <StatCard label="Total Maintenance Cost" value={fmt(fleet.totalMaintenanceCost)} icon={Wrench} />
        <StatCard label="Total Distance" value={`${fleet.totalDistanceKm.toLocaleString()} km`} icon={Route} />
        <StatCard
          label="Fuel Cost / KM"
          value={fleet.overallCostPerKm == null ? 'N/A' : fmt(fleet.overallCostPerKm)}
          icon={Gauge}
        />
      </div>

      {!vanId && (
        <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Fleet — Van-wise Efficiency</CardTitle>
          </CardHeader>
          <CardContent>
            {fleet.byVan.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No fuel/odometer data for selected period</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground uppercase tracking-widest border-b border-border/50">
                      <th className="pb-3 pr-4">Van</th>
                      <th className="pb-3 pr-4 text-right">Fuel Cost</th>
                      <th className="pb-3 pr-4 text-right">Liters</th>
                      <th className="pb-3 pr-4 text-right">Distance</th>
                      <th className="pb-3 text-right">Cost / KM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fleet.byVan.map((v: any) => (
                      <tr key={v.vanId} className="border-b border-border/30 hover:bg-accent/20 transition-colors">
                        <td className="py-3 pr-4 font-semibold">{v.plateNumber}</td>
                        <td className="py-3 pr-4 text-right font-mono">{fmt(v.fuelCost)}</td>
                        <td className="py-3 pr-4 text-right font-mono text-muted-foreground">{v.litersFilled.toLocaleString()} L</td>
                        <td className="py-3 pr-4 text-right font-mono text-muted-foreground">{v.distanceKm.toLocaleString()} km</td>
                        <td className="py-3 text-right font-mono">{v.costPerKm == null ? 'N/A' : fmt(v.costPerKm)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Damage Cases */}
      <SectionTitle>Damage Cases</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Cases" value={String(damage.total)} icon={ShieldAlert} />
        <StatCard label="Open" value={String(damage.open)} icon={ShieldAlert} />
        <StatCard label="Resolved" value={String(damage.resolved)} icon={CheckCircle2} />
        <StatCard label="Bottles Damaged" value={String(damage.totalBottles)} icon={Droplets} sublabel={`${fmt(damage.totalCharged)} charged`} />
      </div>

      {/* Customer Support */}
      <SectionTitle>Customer Support Tickets</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Tickets" value={String(supportTickets.total)} icon={LifeBuoy} />
        <StatCard label="Open" value={String(supportTickets.open)} icon={LifeBuoy} />
        <StatCard label="Resolved" value={String(supportTickets.resolved)} icon={CheckCircle2} />
        <StatCard
          label="Avg Resolution Time"
          value={supportTickets.avgResolutionHours == null ? 'N/A' : `${supportTickets.avgResolutionHours}h`}
          icon={Clock}
        />
      </div>

      {/* WhatsApp Reminders */}
      <SectionTitle>WhatsApp Balance Reminders</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Batches Sent" value={String(reminders.batches)} icon={MessageCircleMore} />
        <StatCard label="Reminders Sent" value={String(reminders.sent)} icon={Send} />
        <StatCard label="Skipped" value={String(reminders.skipped)} icon={SkipForward} />
      </div>
    </div>
  );
}
