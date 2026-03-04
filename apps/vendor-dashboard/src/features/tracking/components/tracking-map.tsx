'use client';

import { useState } from 'react';
import { Map, Marker, NavigationControl, FullscreenControl, ScaleControl, Popup } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTracking } from '../hooks/use-tracking';
import { Truck, Navigation, AlertTriangle } from 'lucide-react';
import { Card, Badge, Separator } from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

export function TrackingMap() {
  const { driverList, isConnected } = useTracking();
  const [selectedDriver, setSelectedDriver] = useState<any>(null);

  const [viewState, setViewState] = useState({
    latitude: 24.8607, // Karachi default
    longitude: 67.0011,
    zoom: 12,
  });

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
              setSelectedDriver(driver);
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
            onClose={() => setSelectedDriver(null)}
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

      {/* Stats Overlay */}
      <div className="absolute bottom-8 left-8 z-10 flex gap-4">
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
    </div>
  );
}
