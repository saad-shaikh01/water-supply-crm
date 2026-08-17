'use client';

import { Card, Badge } from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { MapPin, Package, Clock, Route as RouteIcon, Gauge, TimerOff, LucideIcon } from 'lucide-react';
import type { RouteHistoryStop, RouteHistoryDelivery, RouteHistorySummary } from '../api/tracking.api';

export type TimelineEvent =
  | { key: string; type: 'stop'; time: string; stop: RouteHistoryStop }
  | { key: string; type: 'delivery'; time: string; delivery: RouteHistoryDelivery };

interface RouteHistoryTimelineProps {
  summary: RouteHistorySummary | null;
  events: TimelineEvent[];
  selectedKey: string | null;
  onSelect: (event: TimelineEvent) => void;
  pointsAvailable: boolean;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function RouteHistoryTimeline({ summary, events, selectedKey, onSelect, pointsAvailable }: RouteHistoryTimelineProps) {
  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {summary && (
        <Card className="p-5 rounded-3xl border-border/50 bg-background/80 backdrop-blur-xl space-y-4 shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Route Summary</h3>
            {!summary.isFinal && (
              <Badge variant="warning" className="text-[9px] px-2 py-0.5 rounded-full">In Progress</Badge>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatBox icon={RouteIcon} label="Distance" value={formatDistance(summary.totalDistanceMeters)} />
            <StatBox icon={Clock} label="Moving Time" value={formatDuration(summary.movingDurationSeconds)} />
            <StatBox icon={TimerOff} label="Stopped Time" value={formatDuration(summary.stopDurationSeconds)} />
            <StatBox icon={Gauge} label="Avg Speed" value={summary.avgSpeedKmh != null ? `${summary.avgSpeedKmh.toFixed(0)} km/h` : '—'} />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground font-bold uppercase tracking-widest pt-3 border-t border-border/40">
            <span>{summary.stopsCount} stop{summary.stopsCount === 1 ? '' : 's'}</span>
            {summary.startedAt && summary.endedAt && (
              <span>{formatTime(summary.startedAt)} – {formatTime(summary.endedAt)}</span>
            )}
          </div>
        </Card>
      )}

      {!pointsAvailable && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[11px] font-semibold text-amber-600 dark:text-amber-400 shrink-0">
          Raw GPS trail for this day has aged past the retention window — the route line isn't available, but stops and the summary above are permanent.
        </div>
      )}

      <Card className="flex-1 min-h-0 rounded-3xl border-border/50 bg-background/80 backdrop-blur-xl p-5 flex flex-col">
        <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-4 shrink-0">Timeline</h3>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No stops or deliveries recorded for this day.</p>
        ) : (
          <div className="flex-1 overflow-y-auto -mr-2 pr-2 space-y-2">
            {events.map((event) => {
              const isDelivery = event.type === 'delivery';
              const isMatchedStop = event.type === 'stop' && event.stop.stopType === 'DELIVERY';
              const title = isDelivery
                ? `Delivered — ${event.delivery.customerName}`
                : isMatchedStop
                  ? `Stopped at ${event.stop.matchedCustomerName}`
                  : 'Unscheduled stop';
              const subtitle = isDelivery
                ? formatTime(event.delivery.deliveredAt)
                : `${formatTime(event.stop.startedAt)} – ${formatTime(event.stop.endedAt)} · ${formatDuration(event.stop.durationSeconds)}`;

              return (
                <button
                  key={event.key}
                  type="button"
                  onClick={() => onSelect(event)}
                  className={cn(
                    'w-full text-left p-3 rounded-2xl border transition-colors flex items-start gap-3',
                    selectedKey === event.key ? 'bg-primary/10 border-primary/40' : 'border-border/40 hover:bg-accent/40',
                  )}
                >
                  <div className={cn(
                    'h-8 w-8 rounded-xl flex items-center justify-center shrink-0',
                    isDelivery ? 'bg-emerald-500/10 text-emerald-500' : isMatchedStop ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-500',
                  )}>
                    {isDelivery ? <Package className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-foreground dark:text-white truncate">{title}</p>
                    <p className="text-[10px] text-muted-foreground font-medium mt-0.5">{subtitle}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function StatBox({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="bg-muted/30 p-3 rounded-2xl border border-border/50">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-black font-mono">{value}</p>
    </div>
  );
}
