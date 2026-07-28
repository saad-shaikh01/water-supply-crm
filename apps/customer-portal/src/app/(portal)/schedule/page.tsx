'use client';

import { CalendarDays, CheckCircle2, Clock, Repeat } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@water-supply-crm/ui';
import { useDeliverySchedule } from '../../../features/deliveries/hooks/use-deliveries';
import { usePortalProfile } from '../../../features/wallet/hooks/use-wallet';
import { cn } from '@water-supply-crm/ui';
import { formatDayLabel } from '../../../lib/day-labels';
import { ListEmptyState, ListErrorState, ListLoadingState } from '../../../components/shared/list-states';

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function SchedulePage() {
  // Fix B3: pass 6-week date range so schedule is never empty
  const from = new Date();
  from.setDate(from.getDate() - 14);
  const to = new Date();
  to.setDate(to.getDate() + 28);

  const { data, isLoading: scheduleLoading, isError: scheduleError, refetch: refetchSchedule } = useDeliverySchedule({
    from: formatLocalDate(from),
    to: formatLocalDate(to),
  });
  const { data: profile, isLoading: profileLoading } = usePortalProfile();

  const schedule = Array.isArray(data) ? data : [];
  const deliverySchedules = (profile as any)?.deliverySchedules ?? [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
      <Card className="rounded-4xl border-border/50 bg-primary/5">
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
                      {formatDayLabel(s.dayOfWeek)}
                    </Badge>
                    {s.van?.plateNumber && (
                      <span className="text-[11px] text-muted-foreground font-bold">{s.van.plateNumber}</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground font-bold">
                Every {deliverySchedules.map((s: any) => formatDayLabel(s.dayOfWeek)).join(', ')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upcoming Deliveries */}
      <div>
        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3 px-1">
          Delivery Calendar
        </p>

        {scheduleLoading ? (
          <ListLoadingState rows={3} />
        ) : scheduleError ? (
          <ListErrorState
            icon={CalendarDays}
            title="Failed to load schedule"
            description="Please retry to load your delivery calendar."
            onRetry={() => refetchSchedule()}
          />
        ) : schedule.length === 0 ? (
          <ListEmptyState
            icon={CalendarDays}
            title="No upcoming deliveries"
            description="Your delivery schedule will appear here once confirmed"
          />
        ) : (
          <div className="space-y-3">
            {schedule.map((item: any) => {
              const [y, m, d] = (item.date ?? item.scheduledDate).split('-').map(Number);
              const date = new Date(y, m - 1, d);
              const isFutureOrToday = date >= today;
              const isCompleted = item.status === 'COMPLETED';
              const isUpcoming = isFutureOrToday && !isCompleted;

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
                        <Badge variant={isUpcoming ? 'primary' : 'success'}>
                          {isCompleted ? 'Completed' : (isFutureOrToday ? 'Upcoming' : 'Past')}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {item.status === 'SCHEDULED' ? 'Standard Schedule' : item.status}
                        {item.route?.name ? ` · ${item.route.name}` : ''}
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
