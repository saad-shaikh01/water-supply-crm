'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Map, Marker, NavigationControl, FullscreenControl, ScaleControl, Popup, useMap, MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTracking } from '../hooks/use-tracking';
import { Truck, Navigation, AlertTriangle, ExternalLink, Activity, Info, Map as MapIcon, Crosshair, X as CloseIcon, List } from 'lucide-react';
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

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

export function TrackingMap() {
  const { drivers, driverList, isConnected } = useTracking();
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const mapRef = useRef<MapRef>(null);

  const selectedDriver = selectedDriverId ? drivers[selectedDriverId] : null;

  const [viewState, setViewState] = useState({
    latitude: 24.8607, // Karachi default
    longitude: 67.0011,
    zoom: 12,
  });

  const handleMarkerClick = (driver: any) => {
    setSelectedDriverId(driver.driverId);
    setIsDrawerOpen(true);
  };

  // Camera lock logic: follow driver when enabled and driver moves
  useEffect(() => {
    if (isFollowing && selectedDriver) {
      setViewState(prev => ({
        ...prev,
        latitude: selectedDriver.latitude,
        longitude: selectedDriver.longitude,
      }));
    }
  }, [selectedDriver?.latitude, selectedDriver?.longitude, isFollowing]);

  const toggleFollow = () => {
    setIsFollowing(!isFollowing);
    if (!isFollowing && selectedDriver) {
      setViewState(prev => ({
        ...prev,
        latitude: selectedDriver.latitude,
        longitude: selectedDriver.longitude,
        zoom: 15, // Zoom in when starting to follow
      }));
    }
  };

  // Fail clearly — do not silently embed a fallback token.
  if (!MAPBOX_TOKEN) {
    return (
      <div className="relative w-full h-[calc(100vh-200px)] rounded-[2.5rem] overflow-hidden border border-destructive/30 bg-destructive/5 flex flex-col items-center justify-center gap-3 text-destructive">
        <AlertTriangle className="h-8 w-8" />
        <p className="text-sm font-bold">Map not configured</p>
        <p className="text-xs text-muted-foreground">Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN in your environment.</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[calc(100vh-200px)] rounded-[2.5rem] overflow-hidden border border-border/50 shadow-2xl bg-muted/20">
      <Map
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        mapStyle="mapbox://styles/mapbox/navigation-day-v1"
        mapboxAccessToken={MAPBOX_TOKEN}
      >
        <NavigationControl position="top-right" />
        <FullscreenControl position="top-right" />
        <ScaleControl />

        {driverList.map((driver) => (
          <Marker
            key={driver.driverId}
            latitude={driver.latitude}
            longitude={driver.longitude}
            anchor="bottom"
            onClick={e => {
              e.originalEvent.stopPropagation();
              handleMarkerClick(driver);
            }}
          >
            <div className="group cursor-pointer">
              <div className="relative flex flex-col items-center">
                <div className="px-2 py-1 bg-background border border-border/50 rounded-lg shadow-xl mb-1 text-[10px] font-black uppercase tracking-tighter transform group-hover:-translate-y-1 transition-all duration-300">
                  {driver.driverName}
                </div>
                <div className={cn(
                  "h-10 w-10 rounded-2xl flex items-center justify-center shadow-lg transform transition-all duration-500 group-hover:scale-110",
                  driver.freshness === 'LIVE' ? (
                    driver.status === 'DELIVERING' ? "bg-primary text-white shadow-primary/20" : "bg-emerald-500 text-white shadow-emerald-500/20"
                  ) :
                  driver.freshness === 'STALE' ? "bg-amber-500 text-white shadow-amber-500/20" :
                  "bg-zinc-500 text-white shadow-zinc-500/20"
                )}>
                  <Truck className="h-6 w-6" />

                  {/* Freshness Indicator Dot */}
                  <div className={cn(
                    "absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white shadow-sm",
                    driver.freshness === 'LIVE' ? "bg-emerald-500" :
                    driver.freshness === 'STALE' ? "bg-amber-500" : "bg-zinc-500"
                  )} />

                  {/* Direction Arrow */}
                  {driver.bearing !== undefined && (
                    <div
                      className="absolute -top-1 -right-1 h-4 w-4 bg-white rounded-full flex items-center justify-center text-primary shadow-sm"
                      style={{ transform: `rotate(${driver.bearing}deg)` }}
                    >
                      <Navigation className="h-2.5 w-2.5 fill-current" />
                    </div>
                  )}
                </div>

                {/* Active pulse for live drivers */}
                {driver.freshness === 'LIVE' && (
                  <div className="absolute inset-0 h-10 w-10 rounded-2xl bg-emerald-500 animate-ping opacity-20 -z-10" />
                )}
              </div>
            </div>
          </Marker>
        ))}

        {selectedDriver && (
          <Popup
            latitude={selectedDriver.latitude}
            longitude={selectedDriver.longitude}
            anchor="top"
            onClose={() => setSelectedDriverId(null)}
            className="z-50"
            closeButton={false}
            offset={10}
          >
            <div className="p-3 min-w-[200px] space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                    {selectedDriver.driverName.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-black">{selectedDriver.driverName}</p>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={selectedDriver.status === 'DELIVERING' ? 'default' : 'secondary'} className="text-[8px] px-1.5 py-0">
                        {selectedDriver.status}
                      </Badge>
                      <Badge 
                        variant={selectedDriver.freshness === 'LIVE' ? 'success' : selectedDriver.freshness === 'STALE' ? 'warning' : 'secondary'} 
                        className="text-[8px] px-1.5 py-0"
                      >
                        {selectedDriver.freshness}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              <Separator className="bg-border/50" />

              <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <div>
                  <p>Speed</p>
                  <p className="text-foreground font-mono">{selectedDriver.speed ? `${selectedDriver.speed} km/h` : 'Stopped'}</p>
                </div>
                <div>
                  <p>Last Seen</p>
                  <p className="text-foreground font-mono">
                    {selectedDriver.lastSeenSeconds < 60 
                      ? `${selectedDriver.lastSeenSeconds}s ago` 
                      : `${Math.floor(selectedDriver.lastSeenSeconds / 60)}m ago`}
                  </p>
                </div>
              </div>
            </div>
          </Popup>
        )}
      </Map>

      {/* Follow Mode Exit Control */}
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
              <span className="text-[10px] font-black uppercase tracking-widest opacity-70">Following</span>
              <span className="text-sm font-black">{selectedDriver.driverName}</span>
            </div>
          </Button>
        </div>
      )}

      {/* Stats & Legend Overlay */}
      <div className="absolute bottom-8 left-8 z-10 flex flex-col gap-4">
        {/* Legend */}
        <Card className="bg-background/80 backdrop-blur-xl border-border/50 px-6 py-4 rounded-3xl shadow-2xl space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <List className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Map Legend</span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
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
              <div className="h-3 w-3 rounded-md bg-primary flex items-center justify-center text-[8px] text-white">
                <Truck className="h-2 w-2" />
              </div>
              <span className="text-[10px] font-bold text-foreground/70 uppercase">Delivering</span>
            </div>
          </div>
        </Card>

        <Card className="bg-background/80 backdrop-blur-xl border-border/50 px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Active Drivers</span>
            <span className="text-2xl font-black font-mono">{driverList.length}</span>
          </div>
          <div className="h-10 w-[1px] bg-border/50" />
          <div className="flex items-center gap-2">
            <div className={cn(
              "h-3 w-3 rounded-full animate-pulse",
              isConnected ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-destructive shadow-[0_0_10px_rgba(239,68,68,0.5)]"
            )} />
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              {isConnected ? 'Live Connected' : 'Disconnected'}
            </span>
          </div>
        </Card>
      </div>

      <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <SheetContent side="right" className="w-[400px] sm:w-[450px] border-l border-border/50 bg-background/95 backdrop-blur-xl p-0">
          {selectedDriver && (
            <div className="flex flex-col h-full">
              <SheetHeader className="p-8 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <Badge 
                    variant={selectedDriver.freshness === 'LIVE' ? 'success' : selectedDriver.freshness === 'STALE' ? 'warning' : 'secondary'} 
                    className="rounded-full px-3 py-1 uppercase tracking-widest text-[10px] font-black"
                  >
                    {selectedDriver.freshness}
                  </Badge>
                  <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-widest">
                    Last sync: {new Date(selectedDriver.updatedAt).toLocaleTimeString()}
                  </span>
                </div>
                <SheetTitle className="text-3xl font-black tracking-tighter flex items-center gap-3">
                  <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary text-xl">
                    {selectedDriver.driverName.charAt(0)}
                  </div>
                  {selectedDriver.driverName}
                </SheetTitle>
                <SheetDescription className="text-sm font-medium text-muted-foreground">
                  Active delivery personnel currently in the field.
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Operational Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-muted/30 p-4 rounded-3xl border border-border/50">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Current Speed</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-black font-mono">{selectedDriver.speed || 0}</span>
                      <span className="text-xs font-bold text-muted-foreground">km/h</span>
                    </div>
                  </div>
                  <div className="bg-muted/30 p-4 rounded-3xl border border-border/50">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Bearing</p>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-black font-mono">{selectedDriver.bearing || 0}°</span>
                      <Navigation 
                        className="h-4 w-4 text-primary fill-current" 
                        style={{ transform: `rotate(${selectedDriver.bearing || 0}deg)` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Contextual Info */}
                <div className="space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                    <Info className="h-3 w-3" /> Logistics Context
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-4 rounded-2xl bg-background border border-border/50">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Assigned Van</span>
                        <span className="font-bold text-sm">{selectedDriver.vanId || 'No Van Assigned'}</span>
                      </div>
                      <Link href={`/dashboard/vans`} className="text-primary hover:bg-primary/10 p-2 rounded-xl transition-colors">
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </div>
                    <div className="flex items-center justify-between p-4 rounded-2xl bg-background border border-border/50">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Active Sheet</span>
                        <span className="font-bold text-sm truncate max-w-[200px]">{selectedDriver.dailySheetId || 'No Active Sheet'}</span>
                      </div>
                      {selectedDriver.dailySheetId && (
                        <Link href={`/dashboard/daily-sheets/${selectedDriver.dailySheetId}`} className="text-primary hover:bg-primary/10 p-2 rounded-xl transition-colors">
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                    <Activity className="h-3 w-3" /> Quick Actions
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    <Button 
                      variant={isFollowing ? "primary" : "outline"} 
                      className={cn(
                        "justify-start gap-3 h-12 rounded-2xl border-border/50 transition-all duration-500",
                        isFollowing ? "bg-primary text-white shadow-lg shadow-primary/20" : "hover:bg-primary/5 hover:text-primary hover:border-primary/20"
                      )}
                      onClick={toggleFollow}
                    >
                      <Crosshair className={cn("h-4 w-4", isFollowing && "animate-pulse")} />
                      {isFollowing ? "Following Driver..." : "Follow Driver on Map"}
                    </Button>
                    <Button variant="outline" className="justify-start gap-3 h-12 rounded-2xl border-border/50 hover:bg-primary/5 hover:text-primary hover:border-primary/20" asChild>
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
                  <div className={cn(
                    "h-2 w-2 rounded-full",
                    selectedDriver.freshness === 'LIVE' ? "bg-emerald-500 animate-pulse" : "bg-zinc-500"
                  )} />
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Stream health: {selectedDriver.freshness === 'LIVE' ? 'Excellent (Sub-second lag)' : 'Degraded'}
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
