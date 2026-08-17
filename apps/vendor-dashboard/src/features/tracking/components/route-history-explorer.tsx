'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Polyline,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { AlertTriangle, Flag, MapPin, Package, Loader2, CalendarDays } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Input, Label, Card } from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import { useAllDrivers } from '../../users/hooks/use-users';
import { useDriverRouteHistory } from '../hooks/use-tracking-history';
import { RouteHistoryTimeline, type TimelineEvent } from './route-history-timeline';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? '';
const DEFAULT_CENTER = { lat: 24.8607, lng: 67.0011 }; // Karachi
const DEFAULT_ZOOM = 12;

function toLocalDateValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface MapApi {
  fitToRoute: () => void;
  centerOn: (lat: number, lng: number, zoom?: number) => void;
}

function MapController({
  boundsPointsRef,
  focusTarget,
  mapApiRef,
}: {
  boundsPointsRef: React.MutableRefObject<{ lat: number; lng: number }[]>;
  focusTarget: { lat: number; lng: number } | null;
  mapApiRef: React.MutableRefObject<MapApi | null>;
}) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');

  useEffect(() => {
    if (!map || !mapsLib) return;
    mapApiRef.current = {
      fitToRoute() {
        const pts = boundsPointsRef.current;
        if (!pts.length) return;
        if (pts.length === 1) {
          map.panTo(pts[0]);
          map.setZoom(15);
          return;
        }
        const bounds = new mapsLib.LatLngBounds();
        pts.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds, 80);
      },
      centerOn(lat, lng, zoom = 16) {
        map.panTo({ lat, lng });
        map.setZoom(zoom);
      },
    };
    return () => { mapApiRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapsLib]);

  useEffect(() => {
    if (focusTarget) mapApiRef.current?.centerOn(focusTarget.lat, focusTarget.lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget]);

  return null;
}

/**
 * Full-day route playback: driver + date filters, a map with the breadcrumb
 * polyline, numbered stop markers and delivery pins, plus a side panel with
 * route stats and a chronological timeline. Clicking a stop/delivery in
 * either the map or the timeline focuses the other.
 */
export function RouteHistoryExplorer() {
  const [driverId, setDriverId] = useQueryState('driverId', parseAsString.withDefault(''));
  const [date, setDate] = useQueryState('date', parseAsString.withDefault(toLocalDateValue(new Date())));

  const { data: driversData } = useAllDrivers();
  const drivers = (driversData as { data?: { id: string; name: string }[] } | undefined)?.data ?? [];

  const { data, isLoading, isFetching } = useDriverRouteHistory(driverId, date);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ lat: number; lng: number } | null>(null);
  const mapApiRef = useRef<MapApi | null>(null);
  const boundsPointsRef = useRef<{ lat: number; lng: number }[]>([]);

  const points = useMemo(() => (data?.points ?? []).map((p) => ({ lat: p.latitude, lng: p.longitude })), [data]);
  // Deliveries already represented by a matched stop aren't shown as a second marker/row.
  const matchedDeliveryIds = useMemo(
    () => new Set((data?.stops ?? []).map((s) => s.matchedDeliveryItemId).filter(Boolean) as string[]),
    [data],
  );
  const unmatchedDeliveries = useMemo(
    () => (data?.deliveries ?? []).filter((d) => !matchedDeliveryIds.has(d.id)),
    [data, matchedDeliveryIds],
  );

  const events: TimelineEvent[] = useMemo(() => {
    const stopEvents: TimelineEvent[] = (data?.stops ?? []).map((stop, i) => ({
      key: `stop-${i}`, type: 'stop', time: stop.startedAt, stop,
    }));
    const deliveryEvents: TimelineEvent[] = unmatchedDeliveries.map((delivery) => ({
      key: `delivery-${delivery.id}`, type: 'delivery', time: delivery.deliveredAt, delivery,
    }));
    return [...stopEvents, ...deliveryEvents].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }, [data, unmatchedDeliveries]);

  // Bounds source: raw points when available, else fall back to stop/delivery locations
  useEffect(() => {
    if (points.length) {
      boundsPointsRef.current = points;
    } else {
      boundsPointsRef.current = [
        ...(data?.stops ?? []).map((s) => ({ lat: s.latitude, lng: s.longitude })),
        ...unmatchedDeliveries.map((d) => ({ lat: d.latitude, lng: d.longitude })),
      ];
    }
    mapApiRef.current?.fitToRoute();
  }, [points, data, unmatchedDeliveries]);

  useEffect(() => {
    setSelectedKey(null);
    setFocusTarget(null);
  }, [driverId, date]);

  const handleSelect = useCallback((event: TimelineEvent) => {
    setSelectedKey(event.key);
    const target = event.type === 'stop'
      ? { lat: event.stop.latitude, lng: event.stop.longitude }
      : { lat: event.delivery.latitude, lng: event.delivery.longitude };
    setFocusTarget(target);
  }, []);

  const todayValue = toLocalDateValue(new Date());
  const hasData = !!data && (points.length > 0 || (data.stops.length + unmatchedDeliveries.length) > 0);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 bg-card/30 p-4 rounded-2xl border border-border">
        <div className="flex-1 space-y-1.5">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Driver</Label>
          <Select value={driverId} onValueChange={(v) => setDriverId(v)}>
            <SelectTrigger className="h-11 rounded-xl bg-background/50 border-border/50">
              <SelectValue placeholder="Select a driver" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border/50 shadow-2xl">
              {drivers.map((driver) => (
                <SelectItem key={driver.id} value={driver.id} className="rounded-lg">{driver.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 space-y-1.5">
          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <CalendarDays className="h-3 w-3" /> Date
          </Label>
          <Input
            type="date"
            value={date}
            max={todayValue}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-11 rounded-xl bg-background/50 border-border/50"
          />
        </div>
        {isFetching && !isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pb-2.5 sm:pb-0 sm:h-11">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Refreshing…
          </div>
        )}
      </Card>

      {!driverId ? (
        <EmptyState icon={MapPin} title="Select a driver" message="Pick a driver and date above to replay their route." />
      ) : isLoading ? (
        <div className="h-[600px] rounded-[2rem] border border-border/50 bg-muted/20 animate-pulse" />
      ) : !hasData ? (
        <EmptyState icon={AlertTriangle} title="No data for this day" message="No GPS breadcrumbs, stops, or deliveries were recorded for this driver on this date." />
      ) : !GOOGLE_MAPS_API_KEY ? (
        <EmptyState icon={AlertTriangle} title="Map not configured" message="Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in your environment." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 items-start">
          <div className="relative w-full h-[600px] rounded-[2rem] overflow-hidden border border-border/50 shadow-2xl bg-muted/20">
            <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
              <Map
                defaultCenter={points[0] ?? boundsPointsRef.current[0] ?? DEFAULT_CENTER}
                defaultZoom={DEFAULT_ZOOM}
                mapId={GOOGLE_MAPS_MAP_ID || undefined}
                gestureHandling="greedy"
                disableDefaultUI
                clickableIcons={false}
                className="w-full h-full"
              >
                <MapController boundsPointsRef={boundsPointsRef} focusTarget={focusTarget} mapApiRef={mapApiRef} />

                {points.length > 1 && (
                  <Polyline
                    path={points}
                    strokeColor="#6366f1"
                    strokeOpacity={0.85}
                    strokeWeight={4}
                  />
                )}

                {points.length > 0 && (
                  <AdvancedMarker position={points[0]} zIndex={5}>
                    <div className="h-7 w-7 rounded-full bg-emerald-500 border-2 border-white shadow-lg flex items-center justify-center text-white">
                      <Flag className="h-3.5 w-3.5" />
                    </div>
                  </AdvancedMarker>
                )}
                {points.length > 1 && (
                  <AdvancedMarker position={points[points.length - 1]} zIndex={5}>
                    <div className="h-7 w-7 rounded-full bg-zinc-700 border-2 border-white shadow-lg flex items-center justify-center text-white">
                      <Flag className="h-3.5 w-3.5 fill-current" />
                    </div>
                  </AdvancedMarker>
                )}

                {(data?.stops ?? []).map((stop, i) => {
                  const key = `stop-${i}`;
                  const isMatched = stop.stopType === 'DELIVERY';
                  return (
                    <AdvancedMarker
                      key={key}
                      position={{ lat: stop.latitude, lng: stop.longitude }}
                      zIndex={selectedKey === key ? 10 : 2}
                      onClick={() => handleSelect({ key, type: 'stop', time: stop.startedAt, stop })}
                    >
                      <div
                        className={cn(
                          'h-8 w-8 rounded-2xl border-2 border-white shadow-lg flex items-center justify-center text-white text-[11px] font-black cursor-pointer transition-transform',
                          selectedKey === key && 'scale-125',
                          isMatched ? 'bg-primary' : 'bg-amber-500',
                        )}
                      >
                        {i + 1}
                      </div>
                    </AdvancedMarker>
                  );
                })}

                {unmatchedDeliveries.map((delivery) => {
                  const key = `delivery-${delivery.id}`;
                  return (
                    <AdvancedMarker
                      key={key}
                      position={{ lat: delivery.latitude, lng: delivery.longitude }}
                      zIndex={selectedKey === key ? 10 : 3}
                      onClick={() => handleSelect({ key, type: 'delivery', time: delivery.deliveredAt, delivery })}
                    >
                      <div
                        className={cn(
                          'h-7 w-7 rounded-xl border-2 border-white shadow-lg flex items-center justify-center text-white bg-emerald-500 cursor-pointer transition-transform',
                          selectedKey === key && 'scale-125',
                        )}
                      >
                        <Package className="h-3.5 w-3.5" />
                      </div>
                    </AdvancedMarker>
                  );
                })}
              </Map>
            </APIProvider>
          </div>

          <div className="h-[600px]">
            <RouteHistoryTimeline
              summary={data?.summary ?? null}
              events={events}
              selectedKey={selectedKey}
              onSelect={handleSelect}
              pointsAvailable={data?.pointsAvailable ?? true}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, title, message }: { icon: typeof MapPin; title: string; message: string }) {
  return (
    <div className="h-[400px] rounded-[2rem] border border-border/50 bg-muted/10 flex flex-col items-center justify-center gap-3 text-center px-8">
      <Icon className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-bold text-foreground dark:text-white">{title}</p>
      <p className="text-xs text-muted-foreground max-w-sm">{message}</p>
    </div>
  );
}
