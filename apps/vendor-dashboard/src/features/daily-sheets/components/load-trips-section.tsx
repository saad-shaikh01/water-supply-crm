'use client';

import { Card, CardContent, Button, Badge } from '@water-supply-crm/ui';
import { AlertCircle, Clock, Plus, Truck } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { motion } from 'framer-motion';
import type { LoadTrip } from '@water-supply-crm/types';

const formatTime = (dt: string) =>
  new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface LoadTripsSectionProps {
  loads: LoadTrip[];
  isClosed: boolean;
  activeTrip: LoadTrip | null;
  hasAnyTrip: boolean;
  isAdminOrStaff: boolean;
  onNewTrip: () => void;
  onReconcile: () => void;
  onCheckin: (tripId: string) => void;
}

export function LoadTripsSection({
  loads,
  isClosed,
  activeTrip,
  hasAnyTrip,
  isAdminOrStaff,
  onNewTrip,
  onReconcile,
  onCheckin,
}: LoadTripsSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-black flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          Load Trips
          <Badge variant="secondary" className="font-bold text-xs">{loads.length}</Badge>
        </h3>
        <div className="flex gap-2">
          {!isClosed && !activeTrip && isAdminOrStaff && (
            <Button
              size="sm"
              onClick={onNewTrip}
              className="rounded-full font-bold shadow-lg shadow-primary/20 gap-2"
            >
              <Plus className="h-3.5 w-3.5" />
              New Load-Out
            </Button>
          )}
          {!isClosed && !activeTrip && hasAnyTrip && isAdminOrStaff && (
            <Button
              size="sm"
              variant="default"
              onClick={onReconcile}
              className="rounded-full font-bold"
            >
              Close & Reconcile
            </Button>
          )}
        </div>
      </div>

      {loads.length === 0 ? (
        <Card className="border-dashed border-2 border-border/40">
          <CardContent className="p-8 flex flex-col items-center gap-3 text-center">
            <Truck className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-bold text-muted-foreground">No trips yet</p>
            {isAdminOrStaff && (
              <p className="text-xs text-muted-foreground/60 max-w-[220px]">
                Start a Load-Out to record the first trip for this sheet.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {loads.map((trip, idx) => {
            const isActive = !trip.endedAt;
            const duration = trip.endedAt
              ? Math.round((new Date(trip.endedAt).getTime() - new Date(trip.startedAt).getTime()) / 60000)
              : null;

            return (
              <motion.div
                key={trip.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card className={cn(
                  'border transition-all overflow-hidden',
                  isActive
                    ? 'border-emerald-500/40 bg-emerald-500/5 shadow-sm shadow-emerald-500/10'
                    : 'border-border/50 bg-card/50',
                )}>
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex items-center gap-3 shrink-0">
                        <div className={cn(
                          'h-9 w-9 rounded-full flex items-center justify-center font-black text-sm relative',
                          isActive ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground',
                        )}>
                          {trip.tripNumber}
                          {isActive && (
                            <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 animate-ping" />
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                            Trip {trip.tripNumber}
                          </p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground">
                              {formatTime(trip.startedAt)}
                              {trip.endedAt && ` → ${formatTime(trip.endedAt)} (${duration}m)`}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="rounded-xl bg-orange-500/10 px-3 py-2 text-center">
                          <p className="text-[9px] font-bold uppercase text-orange-500/80">Loaded</p>
                          <p className="text-lg font-black font-mono text-orange-500">{trip.loadedFilled}</p>
                        </div>
                        <div className={cn('rounded-xl px-3 py-2 text-center', trip.endedAt ? 'bg-blue-500/10' : 'bg-muted/30')}>
                          <p className="text-[9px] font-bold uppercase text-muted-foreground">Returned</p>
                          <p className={cn('text-lg font-black font-mono', trip.endedAt ? 'text-blue-500' : 'text-muted-foreground/40')}>
                            {trip.endedAt ? trip.returnedFilled : '—'}
                          </p>
                        </div>
                        <div className={cn('rounded-xl px-3 py-2 text-center', trip.endedAt ? 'bg-purple-500/10' : 'bg-muted/30')}>
                          <p className="text-[9px] font-bold uppercase text-muted-foreground">Empties</p>
                          <p className={cn('text-lg font-black font-mono', trip.endedAt ? 'text-purple-500' : 'text-muted-foreground/40')}>
                            {trip.endedAt ? trip.collectedEmpty : '—'}
                          </p>
                        </div>
                        <div className={cn('rounded-xl px-3 py-2 text-center', trip.endedAt ? 'bg-emerald-500/10' : 'bg-muted/30')}>
                          <p className="text-[9px] font-bold uppercase text-muted-foreground">Cash</p>
                          <p className={cn('text-lg font-black font-mono', trip.endedAt ? 'text-emerald-500' : 'text-muted-foreground/40')}>
                            {trip.endedAt ? `₨${trip.cashHandedIn}` : '—'}
                          </p>
                        </div>
                      </div>

                      {isActive && !isClosed && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full font-bold border-emerald-500/50 text-emerald-600 hover:bg-emerald-500/10 shrink-0"
                          onClick={() => onCheckin(trip.id)}
                        >
                          Check In
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {activeTrip && !isClosed && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-sm font-semibold text-amber-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Trip {activeTrip.tripNumber} is in progress. Check in before starting a new trip.
        </div>
      )}
    </div>
  );
}
