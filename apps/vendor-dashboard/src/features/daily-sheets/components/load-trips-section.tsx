'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, Button, Badge } from '@water-supply-crm/ui';
import { AlertCircle, ChevronUp, Clock, Eye, Loader2, Lock, Plus, Send, Truck, Unlock } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { motion, AnimatePresence } from 'framer-motion';
import type { DeliveryItem, LoadTrip } from '@water-supply-crm/types';
import { StatusBadge } from '../../../components/shared/status-badge';

const formatTime = (dt: string) =>
  new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Per-trip aggregation of deliveries/expenses recorded while that trip was
 * active (matched on DailySheetItem.dailySheetLoadId / Expense.dailySheetLoadId).
 * Computed by the parent (sheet-detail.tsx) from the sheet's items/expenses —
 * this component stays free of those raw arrays and just renders the map. */
interface TripStats {
  deliveryCount: number;
  deliveriesCash: number;
  expensesTotal: number;
  expectedCash: number;
  /** The actual matched delivery rows — powers the "View Deliveries" toggle below. */
  items: DeliveryItem[];
}

interface LoadTripsSectionProps {
  loads: LoadTrip[];
  isClosed: boolean;
  activeTrip: LoadTrip | null;
  hasAnyTrip: boolean;
  canLoadOut: boolean;
  canClose: boolean;
  /** Keyed by trip id — see TripStats. */
  tripStats: Record<string, TripStats>;
  /** Soft Close (Amendment R9) — Driver/Salesman self-close permission. */
  canRequestClose: boolean;
  onNewTrip: () => void;
  onReconcile: () => void;
  /** Soft Close (Amendment R9) — Driver/Salesman self-close trigger. */
  onRequestClose: () => void;
  onCheckin: (tripId: string) => void;
  // Trip Edit-Unlock — same shape as delivery-items-list.tsx's edit-unlock props.
  isDriver: boolean;
  canManageEditLocks: boolean;
  onEditTrip: (loadId: string) => void;
  onRequestEditTrip: (loadId: string) => void;
  requestingTripId: string | null;
  onUnlockEditTrip: (loadId: string) => void;
  unlockingTripId: string | null;
}

export function LoadTripsSection({
  loads,
  isClosed,
  activeTrip,
  hasAnyTrip,
  canLoadOut,
  canClose,
  tripStats,
  canRequestClose,
  onNewTrip,
  onReconcile,
  onRequestClose,
  onCheckin,
  isDriver,
  canManageEditLocks,
  onEditTrip,
  onRequestEditTrip,
  requestingTripId,
  onUnlockEditTrip,
  unlockingTripId,
}: LoadTripsSectionProps) {
  const [now, setNow] = useState(() => new Date());
  // "View Deliveries" toggle per trip card — independent per trip, so a staff
  // member can have two trips' delivery lists open side by side.
  const [expandedTripIds, setExpandedTripIds] = useState<Set<string>>(new Set());
  const toggleDeliveries = (tripId: string) => {
    setExpandedTripIds((prev) => {
      const next = new Set(prev);
      if (next.has(tripId)) next.delete(tripId); else next.add(tripId);
      return next;
    });
  };

  useEffect(() => {
    if (!activeTrip) return;
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, [activeTrip]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-black flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          Load Trips
          <Badge variant="secondary" className="font-bold text-xs">{loads.length}</Badge>
        </h3>
        <div className="flex flex-wrap gap-2">
          {!isClosed && !activeTrip && canLoadOut && (
            <Button
              size="sm"
              onClick={onNewTrip}
              className="rounded-full font-bold shadow-lg shadow-primary/20 gap-2"
            >
              <Plus className="h-3.5 w-3.5" />
              New Load-Out
            </Button>
          )}
          {!isClosed && !activeTrip && hasAnyTrip && canClose && (
            <Button
              size="sm"
              variant="default"
              onClick={onReconcile}
              className="rounded-full font-bold"
            >
              Close & Reconcile
            </Button>
          )}
          {/* Soft Close (Amendment R9): Driver/Salesman self-close — only shown when the
              viewer doesn't already have the direct-close permission above, so a role
              that somehow holds both never sees two close buttons. */}
          {!isClosed && !activeTrip && hasAnyTrip && !canClose && canRequestClose && (
            <Button
              size="sm"
              variant="default"
              onClick={onRequestClose}
              className="rounded-full font-bold"
            >
              Close Sheet
            </Button>
          )}
        </div>
      </div>

      {loads.length === 0 ? (
        <Card className="border-dashed border-2 border-border/40">
          <CardContent className="p-8 flex flex-col items-center gap-3 text-center">
            <Truck className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-bold text-muted-foreground">No trips yet</p>
            {canLoadOut && (
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
            // Trip Edit-Unlock — same hasActiveEditUnlock shape as delivery-items-list.tsx.
            const hasActiveEditUnlock =
              !!trip.editUnlockExpiresAt && new Date(trip.editUnlockExpiresAt) > new Date();
            // Deliveries/Expenses/Expected Cash — precomputed by the parent from
            // items/expenses linked to this trip; a trip with no linked rows yet
            // (e.g. just started, nothing delivered) falls back to zeros.
            const stats = tripStats[trip.id] ?? { deliveryCount: 0, deliveriesCash: 0, expensesTotal: 0, expectedCash: 0, items: [] };
            const deliveriesOpen = expandedTripIds.has(trip.id);

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
                              {trip.endedAt
                                ? ` → ${formatTime(trip.endedAt)} (${duration}m)`
                                : ` · ${Math.round((now.getTime() - new Date(trip.startedAt).getTime()) / 60000)}m elapsed`}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
                        <div className="rounded-xl bg-emerald-500/10 px-3 py-2 text-center">
                          <p className="text-[9px] font-bold uppercase text-emerald-500/80">Deliveries</p>
                          <p className="text-lg font-black font-mono text-emerald-500">
                            {stats.deliveryCount} <span className="text-xs font-normal">· ₨{stats.deliveriesCash.toLocaleString()}</span>
                          </p>
                        </div>
                        <div className="rounded-xl bg-red-500/10 px-3 py-2 text-center">
                          <p className="text-[9px] font-bold uppercase text-red-500/80">Expenses</p>
                          <p className="text-lg font-black font-mono text-red-500">₨{stats.expensesTotal.toLocaleString()}</p>
                        </div>
                        <div
                          className="rounded-xl bg-teal-500/10 px-3 py-2 text-center"
                          title="Running total through this trip — includes every earlier trip's net too, since cash is only handed in once at day's end."
                        >
                          <p className="text-[9px] font-bold uppercase text-teal-500/80">Expected Cash</p>
                          <p className="text-lg font-black font-mono text-teal-500">₨{stats.expectedCash.toLocaleString()}</p>
                        </div>
                      </div>

                      {/* View Deliveries — toggles the panel below listing just this
                          trip's linked deliveries (dailySheetLoadId match), independent
                          of the isActive/isClosed state so it's always available, even
                          on a long-closed trip. */}
                      <button
                        type="button"
                        onClick={() => toggleDeliveries(trip.id)}
                        title={deliveriesOpen ? 'Hide deliveries' : 'View deliveries for this trip'}
                        className={cn(
                          'h-9 w-9 rounded-full flex items-center justify-center shrink-0 transition-colors relative',
                          deliveriesOpen
                            ? 'bg-emerald-500/15 text-emerald-600'
                            : 'text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10',
                        )}
                      >
                        {deliveriesOpen ? <ChevronUp className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        {stats.deliveryCount > 0 && (
                          <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-0.5 rounded-full bg-emerald-500 text-white text-[9px] font-black flex items-center justify-center leading-none">
                            {stats.deliveryCount}
                          </span>
                        )}
                      </button>

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

                      {/* Trip Edit-Unlock — mirrors delivery-items-list.tsx's button
                          cluster exactly: driver's 3-state Edit/Requested/Request Edit,
                          plus staff's pulsing Unlock icon-button. */}
                      {!isActive && !isClosed && (
                        <div className="flex items-center gap-1 shrink-0">
                          {isDriver ? (
                            hasActiveEditUnlock ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full font-bold border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                                onClick={() => onEditTrip(trip.id)}
                              >
                                Edit
                              </Button>
                            ) : trip.editRequestedAt ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled
                                className="rounded-full font-bold opacity-60 cursor-not-allowed border-blue-500/40 text-blue-500"
                              >
                                <Send className="h-3 w-3 mr-1" /> Requested
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={requestingTripId === trip.id}
                                onClick={() => onRequestEditTrip(trip.id)}
                                className="rounded-full font-bold border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
                              >
                                {requestingTripId === trip.id
                                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  : <Lock className="h-3 w-3 mr-1" />}
                                Request Edit
                              </Button>
                            )
                          ) : (
                            // STAFF/VENDOR_ADMIN can always edit a trip directly — the
                            // unlock-window check only applies to the DRIVER role
                            // (mirrors checkinLoad()'s forceResubmit gate exactly, same
                            // asymmetry as delivery-items-list.tsx's non-driver branch).
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-full font-bold"
                              onClick={() => onEditTrip(trip.id)}
                            >
                              Edit
                            </Button>
                          )}
                          {canManageEditLocks && (
                            <button
                              type="button"
                              className={cn(
                                'h-8 w-8 rounded-full flex items-center justify-center transition-colors relative',
                                trip.editRequestedAt && !hasActiveEditUnlock
                                  ? 'text-amber-600 bg-amber-500/15 hover:bg-amber-500/25'
                                  : 'text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10',
                              )}
                              title={trip.editRequestedAt && !hasActiveEditUnlock ? 'Driver requested edit — click to unlock' : 'Unlock edit for driver'}
                              disabled={unlockingTripId === trip.id}
                              onClick={() => onUnlockEditTrip(trip.id)}
                            >
                              {unlockingTripId === trip.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <>
                                  <Unlock className="h-3.5 w-3.5" />
                                  {trip.editRequestedAt && !hasActiveEditUnlock && (
                                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                                  )}
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {hasActiveEditUnlock && (
                      <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-2">
                        <Unlock className="h-3 w-3" />
                        Edit unlocked · expires {new Date(trip.editUnlockExpiresAt!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </p>
                    )}

                    {/* This trip's linked deliveries (dailySheetLoadId match) — same
                        rows the Deliveries chip above counts, just listed out. */}
                    <AnimatePresence>
                      {deliveriesOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 pt-3 border-t border-border/40 space-y-1.5">
                            {stats.items.length === 0 ? (
                              <p className="text-xs text-muted-foreground text-center py-3">
                                No deliveries recorded on this trip yet.
                              </p>
                            ) : (
                              stats.items.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between gap-2 rounded-xl bg-background/70 border border-border/40 px-3 py-2 text-xs"
                                >
                                  <div className="min-w-0 flex items-center gap-2">
                                    <span className="font-bold truncate">{item.customer?.name}</span>
                                    <span className="text-[9px] font-mono text-muted-foreground shrink-0">
                                      {item.customer?.customerCode}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {item.filledDropped > 0 && (
                                      <span className="text-[10px] font-bold text-orange-600">↓{item.filledDropped}</span>
                                    )}
                                    <span className="font-mono font-bold text-emerald-600">
                                      ₨{item.cashCollected.toLocaleString()}
                                    </span>
                                    <StatusBadge status={item.status} />
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
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
