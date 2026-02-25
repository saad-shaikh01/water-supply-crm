'use client';

import { CalendarDays, CheckCircle2, Clock, Repeat } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@water-supply-crm/ui';
import { useDeliverySchedule } from '../../../features/deliveries/hooks/use-deliveries';
import { usePortalProfile } from '../../../features/wallet/hooks/use-wallet';
import { cn } from '@water-supply-crm/ui';

const DAY_LABELS: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };

export default function SchedulePage() {
  // Fix B3: pass 6-week date range so schedule is never empty
  const from = new Date();
  from.setDate(from.getDate() - 14);
  const to = new Date();
  to.setDate(to.getDate() + 28);

  const { data, isLoading: scheduleLoading } = useDeliverySchedule({
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  });
  const { data: profile, isLoading: profileLoading } = usePortalProfile();

  const schedule = (data as any)?.data ?? (Array.isArray(data) ? data : []);
  const deliverySchedules = (profile as any)?.deliverySchedules ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <CalendarDays className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Schedule</h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Delivery Calendar</p>
        </div>
      </div>

      {/* Recurring Pattern Section */}
      <Card className="rounded-[2rem] border-border/50 bg-primary/5">
        <CardHeader className="border-b border-border/50 px-6 py-4">
          <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Repeat className="h-3 w-3 text-primary" /> Your Delivery Pattern
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {profileLoading ? (
            <div className="flex gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 w-16 rounded-xl bg-accent/30 animate-pulse" />
              ))}
            </div>
          ) : deliverySchedules.length === 0 ? (
            <p className="text-sm font-bold text-muted-foreground italic">No recurring schedule set</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {deliverySchedules.map((s: any) => (
                  <div key={s.id ?? s.dayOfWeek} className="flex items-center gap-2 bg-primary/10 rounded-xl px-3 py-1.5">
                    <Badge className="bg-primary/20 text-primary border-0 font-black text-[11px] px-2 py-0">
                      {DAY_LABELS[s.dayOfWeek] ?? `Day ${s.dayOfWeek}`}
                    </Badge>
                    {s.van?.plateNumber && (
                      <span className="text-[11px] text-muted-foreground font-bold">{s.van.plateNumber}</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground font-bold">
                Every {deliverySchedules.map((s: any) => DAY_LABELS[s.dayOfWeek]).join(', ')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upcoming Deliveries */}
      <div>
        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3 px-1">
          Upcoming Deliveries
        </p>

        {scheduleLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-2xl bg-accent/30 animate-pulse" />
            ))}
          </div>
        ) : schedule.length === 0 ? (
          <Card className="bg-card/50">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarDays className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="font-bold text-muted-foreground">No upcoming deliveries</p>
              <p className="text-sm text-muted-foreground/60 mt-1">
                Your delivery schedule will appear here once confirmed
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {schedule.map((item: any) => {
              const date = new Date(item.date ?? item.scheduledDate);
              const isUpcoming = date >= new Date();
              return (
                <Card key={item.id ?? item.date} className="bg-card/50 backdrop-blur-sm border-border/50">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={cn(
                      'h-10 w-10 rounded-xl flex items-center justify-center shrink-0',
                      isUpcoming ? 'bg-primary/10 text-primary' : 'bg-emerald-500/10 text-emerald-500',
                    )}>
                      {isUpcoming ? <Clock className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">
                          {date.toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'short' })}
                        </span>
                        <Badge className={cn(
                          'text-[10px] px-2 py-0 rounded-full border-none font-bold',
                          isUpcoming ? 'bg-primary/10 text-primary' : 'bg-emerald-500/10 text-emerald-500',
                        )}>
                          {isUpcoming ? 'Upcoming' : 'Completed'}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {item.route?.name ?? ''}{item.product?.name ? ` · ${item.product.name}` : ''}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
