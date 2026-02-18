'use client';

import { CalendarDays, CheckCircle2, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@water-supply-crm/ui';
import { useDeliverySchedule } from '../../../features/deliveries/hooks/use-deliveries';
import { cn } from '@water-supply-crm/ui';

export default function SchedulePage() {
  const { data, isLoading } = useDeliverySchedule();
  const schedule = (data as any)?.data ?? (Array.isArray(data) ? data : []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <CalendarDays className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Schedule</h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Upcoming Deliveries</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-2xl bg-accent/30 animate-pulse" />
          ))}
        </div>
      ) : schedule.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CalendarDays className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="font-bold text-muted-foreground">No upcoming deliveries</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Your delivery schedule will appear here</p>
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
                    "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                    isUpcoming ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-500"
                  )}>
                    {isUpcoming ? <Clock className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">
                        {date.toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'short' })}
                      </span>
                      <Badge className={cn(
                        "text-[10px] px-2 py-0 rounded-full border-none font-bold",
                        isUpcoming ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-500"
                      )}>
                        {isUpcoming ? 'Upcoming' : 'Completed'}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {item.route?.name ?? ''} {item.product?.name ? `· ${item.product.name}` : ''}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
