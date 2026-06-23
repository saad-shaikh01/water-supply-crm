'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { useTracking } from '../hooks/use-tracking';
import type { DriverLocation } from '../api/tracking.api';
import {
  Truck,
  Navigation,
  AlertTriangle,
  ExternalLink,
  Activity,
  Info,
  Map as MapIcon,
  Crosshair,
  X as CloseIcon,
  List,
  Signal,
  SignalLow,
  WifiOff,
  Maximize,
  Target,
  RotateCcw,
  ChevronDown,
} from 'lucide-react';
import {
  Card,
  Badge,
  Separator,
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import Link from 'next/link';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? '';
const DEFAULT_CENTER = { lat: 24.8607, lng: 67.0011 }; // Karachi
const DEFAULT_ZOOM = 12;
const MARKER_ANIMATION_MS = 1_200;

// ─── Imperative map API (populated by MapController) ─────────────────────────

interface MapApi {
  centerFleet: () => void;
  centerOnDriver: (lat: number, lng: number) => void;
  resetView: () => void;
}

// ─── Animated driver marker ───────────────────────────────────────────────────
// Interpolates between GPS positions using rAF + ease-out cubic to avoid
// the jarring teleport that happens when a new position arrives every ~8s.

function AnimatedDriverMarker({
  driver,
  isSelected,
  onClick,
}: {
  driver: DriverLocation;
  isSelected: boolean;
  onClick: (d: DriverLocation) => void;
}) {
  const [displayPos, setDisplayPos] = useState({
    lat: driver.latitude,
    lng: driver.longitude,
  });
  // posRef tracks current rAF position synchronously so the next animation
  // always starts from where the marker actually is, not where it was at last render.
  const posRef = useRef({ lat: driver.latitude, lng: driver.longitude });
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const from = { ...posRef.current };
    const to = { lat: driver.latitude, lng: driver.longitude };

    if (Math.abs(from.lat - to.lat) < 1e-9 && Math.abs(from.lng - to.lng) < 1e-9) return;

    const startTime = performance.now();
    if (animRef.current !== null) cancelAnimationFrame(animRef.current);

    const step = (now: number) => {
      const t = Math.min((now - startTime) / MARKER_ANIMATION_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const next = {
        lat: from.lat + (to.lat - from.lat) * eased,
        lng: from.lng + (to.lng - from.lng) * eased,
      };
      posRef.current = next;
      setDisplayPos(next);
      if (t < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        posRef.current = to;
        animRef.current = null;
      }
    };

    animRef.current = requestAnimationFrame(step);
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, [driver.latitude, driver.longitude]);

  const iconBg =
    driver.freshness === 'LIVE'
      ? driver.status === 'DELIVERING'
        ? 'bg-primary text-white shadow-primary/25'
        : 'bg-emerald-500 text-white shadow-emerald-500/25'
      : driver.freshness === 'STALE'
      ? 'bg-amber-500 text-white shadow-amber-500/25'
      : 'bg-zinc-500 text-white shadow-zinc-500/25';

  const dotBg =
    driver.freshness === 'LIVE'
      ? 'bg-emerald-500'
      : driver.freshness === 'STALE'
      ? 'bg-amber-500'
      : 'bg-zinc-500';

  return (
    <AdvancedMarker
      position={displayPos}
      zIndex={isSelected ? 10 : 1}
      onClick={() => onClick(driver)}
    >
      <div className="group cursor-pointer">
        <div className="relative flex flex-col items-center">
          {/* Name label */}
          <div className="px-2 py-1 bg-background border border-border/50 rounded-lg shadow-xl mb-1 text-[10px] font-black uppercase tracking-tighter transform group-hover:-translate-y-1 transition-all duration-300 whitespace-nowrap select-none">
            {driver.driverName}
          </div>

          {/* Truck icon */}
          <div
            className={cn(
              'relative h-10 w-10 rounded-2xl flex items-center justify-center shadow-lg transform transition-all duration-500 group-hover:scale-110',
              iconBg,
            )}
          >
            <Truck className="h-6 w-6" />

            {/* Freshness dot */}
            <div
              className={cn(
                'absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white shadow-sm',
                dotBg,
              )}
            />

            {/* Direction arrow — only if bearing is known */}
            {driver.bearing !== undefined && (
              <div
                className="absolute -top-1 -right-1 h-4 w-4 bg-white rounded-full flex items-center justify-center text-primary shadow-sm"
                style={{ transform: `rotate(${driver.bearing}deg)` }}
              >
                <Navigation className="h-2.5 w-2.5 fill-current" />
              </div>
            )}
          </div>

          {/* Active pulse ring for live drivers */}
          {driver.freshness === 'LIVE' && (
            <div className="absolute top-6 left-0 h-10 w-10 rounded-2xl bg-emerald-500 animate-ping opacity-20 -z-10" />
          )}
        </div>
      </div>
    </AdvancedMarker>
  );
}

// ─── Null-rendering map controller (must live inside <Map> for useMap()) ─────

function MapController({
  driverListRef,
  followLat,
  followLng,
  mapApiRef,
}: {
  driverListRef: React.MutableRefObject<DriverLocation[]>;
  followLat: number | undefined;
  followLng: number | undefined;
  mapApiRef: React.MutableRefObject<MapApi | null>;
}) {
  const map = useMap();
  // useMapsLibrary loads the typed google.maps namespace — avoids window.google hacks
  const mapsLib = useMapsLibrary('maps');

  // Register imperative API once both map instance and maps library are ready.
  useEffect(() => {
    if (!map || !mapsLib) return;

    mapApiRef.current = {
      centerFleet() {
        const list = driverListRef.current;
        if (list.length === 0) return;
        const bounds = new mapsLib.LatLngBounds();
        list.forEach((d) => bounds.extend({ lat: d.latitude, lng: d.longitude }));
        map.fitBounds(bounds, 100);
      },
      centerOnDriver(lat: number, lng: number) {
        map.panTo({ lat, lng });
        map.setZoom(15);
      },
      resetView() {
        map.panTo(DEFAULT_CENTER);
        map.setZoom(DEFAULT_ZOOM);
      },
    };

    return () => {
      mapApiRef.current = null;
    };
    // driverListRef and mapApiRef are refs — they never change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapsLib]);

  // Follow selected driver: pan whenever their position changes
  useEffect(() => {
    if (!map || followLat == null || followLng == null) return;
    map.panTo({ lat: followLat, lng: followLng });
  }, [map, followLat, followLng]);

  return null;
}

// ─── Main exported component ──────────────────────────────────────────────────

export function TrackingMap() {
  const { drivers, driverList, isConnected, retryCount, lastEventTime } = useTracking();
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [lastEventAge, setLastEventAge] = useState(0);

  // Stable ref for imperative map operations — avoids re-renders on map changes
  const mapApiRef = useRef<MapApi | null>(null);
  // Stable ref so the centerFleet closure always sees the latest list
  const driverListRef = useRef<DriverLocation[]>(driverList);
  useEffect(() => { driverListRef.current = driverList; }, [driverList]);

  const selectedDriver = selectedDriverId ? (drivers[selectedDriverId] ?? null) : null;
  const followLat = isFollowing && selectedDriver ? selectedDriver.latitude : undefined;
  const followLng = isFollowing && selectedDriver ? selectedDriver.longitude : undefined;

  useEffect(() => {
    const timer = setInterval(() => {
      if (lastEventTime)
        setLastEventAge(Math.floor((Date.now() - lastEventTime.getTime()) / 1000));
    }, 1_000);
    return () => clearInterval(timer);
  }, [lastEventTime]);

  const handleMarkerClick = useCallback((driver: DriverLocation) => {
    setSelectedDriverId(driver.driverId);
    setIsDrawerOpen(true);
    setIsFollowing(false);
  }, []);

  const toggleFollow = useCallback(() => {
    setIsFollowing((prev) => {
      const next = !prev;
      if (next && selectedDriver) {
        mapApiRef.current?.centerOnDriver(selectedDriver.latitude, selectedDriver.longitude);
      }
      return next;
    });
  }, [selectedDriver]);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="relative w-full h-[calc(100vh-200px)] rounded-[2.5rem] overflow-hidden border border-destructive/30 bg-destructive/5 flex flex-col items-center justify-center gap-3 text-destructive">
        <AlertTriangle className="h-8 w-8" />
        <p className="text-sm font-bold">Map not configured</p>
        <p className="text-xs text-muted-foreground">
          Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in your environment.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[calc(100vh-180px)] sm:h-[calc(100vh-200px)] rounded-[2rem] sm:rounded-[2.5rem] overflow-hidden border border-border/50 shadow-2xl bg-muted/20">
      <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
        <Map
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          mapId={GOOGLE_MAPS_MAP_ID || undefined}
          gestureHandling="greedy"
          disableDefaultUI
          clickableIcons={false}
          className="w-full h-full"
        >
          <MapController
            driverListRef={driverListRef}
            followLat={followLat}
            followLng={followLng}
            mapApiRef={mapApiRef}
          />

          {driverList.map((driver) => (
            <AnimatedDriverMarker
              key={driver.driverId}
              driver={driver}
              isSelected={driver.driverId === selectedDriverId}
              onClick={handleMarkerClick}
            />
          ))}

          {/* Quick-peek InfoWindow when drawer is closed */}
          {selectedDriver && !isDrawerOpen && (
            <InfoWindow
              position={{ lat: selectedDriver.latitude, lng: selectedDriver.longitude }}
              onCloseClick={() => setSelectedDriverId(null)}
            >
              <div className="p-2 min-w-[160px] space-y-2 text-foreground">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                    {selectedDriver.driverName.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black truncate">{selectedDriver.driverName}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge
                        variant={selectedDriver.status === 'DELIVERING' ? 'default' : 'secondary'}
                        className="text-[8px] px-1.5 py-0"
                      >
                        {selectedDriver.status}
                      </Badge>
                      <Badge
                        variant={
                          selectedDriver.freshness === 'LIVE'
                            ? 'success'
                            : selectedDriver.freshness === 'STALE'
                            ? 'warning'
                            : 'secondary'
                        }
                        className="text-[8px] px-1.5 py-0"
                      >
                        {selectedDriver.freshness}
                      </Badge>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground font-medium">
                  {selectedDriver.lastSeenSeconds < 60
                    ? `${selectedDriver.lastSeenSeconds}s ago`
                    : `${Math.floor(selectedDriver.lastSeenSeconds / 60)}m ago`}
                </p>
              </div>
            </InfoWindow>
          )}
        </Map>
      </APIProvider>

      {/* ── Map control buttons (top-right) ─────────────────────── */}
      <div className="absolute top-4 right-[10px] z-10 flex flex-col gap-2">
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 sm:h-[29px] sm:w-[29px] rounded-md sm:rounded-sm bg-white shadow-md sm:shadow-sm border border-border/50 hover:bg-muted"
          title="Center Fleet"
          onClick={() => mapApiRef.current?.centerFleet()}
          disabled={driverList.length === 0}
        >
          <Maximize className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 sm:h-[29px] sm:w-[29px] rounded-md sm:rounded-sm bg-white shadow-md sm:shadow-sm border border-border/50 hover:bg-muted"
          title="Center Selected Driver"
          disabled={!selectedDriver}
          onClick={() =>
            selectedDriver &&
            mapApiRef.current?.centerOnDriver(selectedDriver.latitude, selectedDriver.longitude)
          }
        >
          <Target className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 sm:h-[29px] sm:w-[29px] rounded-md sm:rounded-sm bg-white shadow-md sm:shadow-sm border border-border/50 hover:bg-muted"
          title="Reset View"
          onClick={() => mapApiRef.current?.resetView()}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      {/* ── Stream health panel (top-left) ──────────────────────── */}
      <div className="absolute top-4 left-4 sm:top-8 sm:left-8 z-10 flex flex-col gap-2 pointer-events-none">
        <Card className="bg-background/80 backdrop-blur-xl border-border/50 px-3 py-2 sm:px-5 sm:py-3 rounded-xl sm:rounded-2xl shadow-2xl flex items-center gap-3 sm:gap-4 pointer-events-auto">
          <div className="flex items-center gap-2 sm:gap-3">
            <div
              className={cn(
                'h-7 w-7 sm:h-8 sm:w-8 rounded-lg sm:rounded-xl flex items-center justify-center transition-colors duration-500',
                isConnected
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : 'bg-destructive/10 text-destructive',
              )}
            >
              {isConnected ? (
                retryCount > 0 ? (
                  <SignalLow className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                ) : (
                  <Signal className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                )
              ) : (
                <WifiOff className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-pulse" />
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground leading-none mb-1">
                Stream
              </span>
              <span
                className={cn(
                  'text-[10px] sm:text-xs font-black uppercase tracking-tighter',
                  isConnected
                    ? retryCount > 0
                      ? 'text-amber-500'
                      : 'text-emerald-500'
                    : 'text-destructive',
                )}
              >
                {isConnected ? (retryCount > 0 ? 'Degraded' : 'Live') : 'Offline'}
              </span>
            </div>
          </div>

          <Separator orientation="vertical" className="h-6 sm:h-8 bg-border/50" />

          <div className="flex flex-col">
            <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground leading-none mb-1">
              Lag
            </span>
            <span
              className={cn(
                'text-[10px] sm:text-xs font-mono font-black',
                lastEventAge < 5
                  ? 'text-emerald-500'
                  : lastEventAge < 15
                  ? 'text-amber-500'
                  : 'text-destructive',
              )}
            >
              {lastEventTime ? `${lastEventAge}s` : '--'}
            </span>
          </div>

          {retryCount > 0 && (
            <>
              <Separator orientation="vertical" className="h-6 sm:h-8 bg-border/50" />
              <div className="flex flex-col">
                <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground leading-none mb-1">
                  Re
                </span>
                <span className="text-[10px] sm:text-xs font-mono font-black text-amber-500">
                  {retryCount}
                </span>
              </div>
            </>
          )}
        </Card>

        {(!isConnected || retryCount > 0 || lastEventAge > 30) && (
          <div className="hidden sm:flex bg-destructive/10 backdrop-blur-md border border-destructive/20 px-4 py-2 rounded-xl items-center gap-2 text-destructive animate-in fade-in slide-in-from-left-4 duration-500">
            <AlertTriangle className="h-3 w-3" />
            <span className="text-[10px] font-black uppercase tracking-widest">
              {!isConnected
                ? 'Reconnecting to live stream...'
                : retryCount > 0
                ? 'Unstable connection detected'
                : 'Data lag exceeds operational threshold'}
            </span>
          </div>
        )}
      </div>

      {/* ── Follow-mode dismiss banner (top-center) ──────────────── */}
      {isFollowing && selectedDriver && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10">
          <Button
            variant="destructive"
            className="rounded-full pl-2 pr-6 h-12 shadow-2xl border-2 border-white/20 animate-in slide-in-from-top-4 duration-500"
            onClick={() => setIsFollowing(false)}
          >
            <div className="bg-white/20 p-2 rounded-full mr-3">
              <CloseIcon className="h-4 w-4" />
            </div>
            <div className="flex flex-col items-start leading-tight">
              <span className="text-[10px] font-black uppercase tracking-widest opacity-70">
                Following
              </span>
              <span className="text-sm font-black">{selectedDriver.driverName}</span>
            </div>
          </Button>
        </div>
      )}

      {/* ── Legend + stats (bottom-left) ─────────────────────────── */}
      <div className="absolute bottom-4 left-4 sm:bottom-8 sm:left-8 z-10 flex flex-col gap-3 sm:gap-4 max-w-[calc(100%-2rem)] sm:max-w-none">
        <details className="group sm:open">
          <summary className="list-none cursor-pointer outline-none">
            <Card className="bg-background/80 backdrop-blur-xl border-border/50 px-4 py-3 sm:px-6 sm:py-4 rounded-2xl sm:rounded-3xl shadow-2xl flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <List className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Map Legend
                </span>
              </div>
              <ChevronDown className="h-3 w-3 text-muted-foreground group-open:rotate-180 transition-transform sm:hidden" />
            </Card>
          </summary>
          <Card className="mt-2 bg-background/80 backdrop-blur-xl border-border/50 px-4 py-3 sm:px-6 sm:py-4 rounded-2xl sm:rounded-3xl shadow-2xl space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="grid grid-cols-2 gap-x-4 sm:gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-[10px] font-bold text-foreground/70 uppercase">Live</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                <span className="text-[10px] font-bold text-foreground/70 uppercase">Stale</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-zinc-500 shadow-[0_0_8px_rgba(113,113,122,0.5)]" />
                <span className="text-[10px] font-bold text-foreground/70 uppercase">Offline</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-md bg-primary flex items-center justify-center">
                  <Truck className="h-2 w-2 text-white" />
                </div>
                <span className="text-[10px] font-bold text-foreground/70 uppercase">
                  Delivering
                </span>
              </div>
            </div>
          </Card>
        </details>

        <Card className="bg-background/80 backdrop-blur-xl border-border/50 px-4 py-3 sm:px-6 sm:py-4 rounded-2xl sm:rounded-3xl shadow-2xl flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Active Drivers
            </span>
            <span className="text-xl sm:text-2xl font-black font-mono leading-none mt-1">
              {driverList.length}
            </span>
          </div>
          <div className="h-8 sm:h-10 w-[1px] bg-border/50" />
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'h-2 w-2 sm:h-3 sm:w-3 rounded-full animate-pulse',
                isConnected
                  ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                  : 'bg-destructive shadow-[0_0_10px_rgba(239,68,68,0.5)]',
              )}
            />
            <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              {isConnected ? 'Stream Active' : 'Disconnected'}
            </span>
          </div>
        </Card>
      </div>

      {/* ── Driver detail side panel ──────────────────────────────── */}
      <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <SheetContent
          side="right"
          className="w-[400px] sm:w-[450px] border-l border-border/50 bg-background/95 backdrop-blur-xl p-0"
        >
          {selectedDriver && (
            <div className="flex flex-col h-full">
              <SheetHeader className="p-8 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <Badge
                    variant={
                      selectedDriver.freshness === 'LIVE'
                        ? 'success'
                        : selectedDriver.freshness === 'STALE'
                        ? 'warning'
                        : 'secondary'
                    }
                    className="rounded-full px-3 py-1 uppercase tracking-widest text-[10px] font-black"
                  >
                    {selectedDriver.freshness}
                  </Badge>
                  <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-widest">
                    Last sync: {new Date(selectedDriver.updatedAt).toLocaleTimeString()}
                  </span>
                </div>
                <SheetTitle className="text-3xl font-black tracking-tighter flex items-center gap-3">
                  <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary text-xl shrink-0">
                    {selectedDriver.driverName.charAt(0)}
                  </div>
                  {selectedDriver.driverName}
                </SheetTitle>
                <SheetDescription className="text-sm font-medium text-muted-foreground">
                  Active delivery personnel currently in the field.
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Speed + bearing */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-muted/30 p-4 rounded-3xl border border-border/50">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">
                      Current Speed
                    </p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-black font-mono">
                        {selectedDriver.speed || 0}
                      </span>
                      <span className="text-xs font-bold text-muted-foreground">km/h</span>
                    </div>
                  </div>
                  <div className="bg-muted/30 p-4 rounded-3xl border border-border/50">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">
                      Bearing
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-black font-mono">
                        {selectedDriver.bearing || 0}°
                      </span>
                      <Navigation
                        className="h-4 w-4 text-primary fill-current"
                        style={{ transform: `rotate(${selectedDriver.bearing || 0}deg)` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Logistics context */}
                <div className="space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                    <Info className="h-3 w-3" /> Logistics Context
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-4 rounded-2xl bg-background border border-border/50">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                          Assigned Van
                        </span>
                        <span className="font-bold text-sm">
                          {selectedDriver.vanId || 'No Van Assigned'}
                        </span>
                      </div>
                      <Link
                        href="/dashboard/vans"
                        className="text-primary hover:bg-primary/10 p-2 rounded-xl transition-colors"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </div>
                    <div className="flex items-center justify-between p-4 rounded-2xl bg-background border border-border/50">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                          Active Sheet
                        </span>
                        <span className="font-bold text-sm truncate max-w-[200px]">
                          {selectedDriver.dailySheetId || 'No Active Sheet'}
                        </span>
                      </div>
                      {selectedDriver.dailySheetId && (
                        <Link
                          href={`/dashboard/daily-sheets/${selectedDriver.dailySheetId}`}
                          className="text-primary hover:bg-primary/10 p-2 rounded-xl transition-colors shrink-0"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick actions */}
                <div className="space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                    <Activity className="h-3 w-3" /> Quick Actions
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    <Button
                      variant={isFollowing ? 'primary' : 'outline'}
                      className={cn(
                        'justify-start gap-3 h-12 rounded-2xl border-border/50 transition-all duration-500',
                        isFollowing
                          ? 'bg-primary text-white shadow-lg shadow-primary/20'
                          : 'hover:bg-primary/5 hover:text-primary hover:border-primary/20',
                      )}
                      onClick={toggleFollow}
                    >
                      <Crosshair className={cn('h-4 w-4', isFollowing && 'animate-pulse')} />
                      {isFollowing ? 'Following Driver...' : 'Follow Driver on Map'}
                    </Button>
                    <Button
                      variant="outline"
                      className="justify-start gap-3 h-12 rounded-2xl border-border/50 hover:bg-primary/5 hover:text-primary hover:border-primary/20"
                      asChild
                    >
                      <Link href={`/dashboard/history?driverId=${selectedDriver.driverId}`}>
                        <MapIcon className="h-4 w-4" />
                        View Location History
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>

              <div className="p-8 border-t border-border/50 bg-muted/20">
                <div className="flex items-center gap-3 p-4 rounded-2xl bg-background border border-border/50">
                  <div
                    className={cn(
                      'h-2 w-2 rounded-full',
                      selectedDriver.freshness === 'LIVE'
                        ? 'bg-emerald-500 animate-pulse'
                        : 'bg-zinc-500',
                    )}
                  />
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Stream health:{' '}
                    {selectedDriver.freshness === 'LIVE'
                      ? 'Excellent (sub-second lag)'
                      : 'Degraded'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
