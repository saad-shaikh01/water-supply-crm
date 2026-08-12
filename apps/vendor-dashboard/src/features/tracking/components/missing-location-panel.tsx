'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, MapPinOff, Clock } from 'lucide-react';
import { trackingApi } from '../api/tracking.api';

/** How often to re-poll — this is a safety net, not a live stream; 30s is plenty. */
const POLL_MS = 30_000;

function timeAgo(iso: string): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

/**
 * Safety net for the location-permission trip-start gate (new-trip-dialog.tsx):
 * even with that gate in place, a driver can still go dark mid-trip (permission
 * revoked, GPS turned off, dead phone, no signal). This surfaces those trips to
 * dispatch directly — regardless of whether the driver ever sees/acts on their
 * own missing-location state — so staff can call them instead of relying on the
 * driver to notice.
 */
export function MissingLocationPanel() {
  const { data } = useQuery({
    queryKey: ['tracking', 'missing'],
    queryFn: () => trackingApi.getMissingLocationDrivers().then((r) => r.data),
    refetchInterval: POLL_MS,
  });

  const drivers = data ?? [];
  if (drivers.length === 0) return null;

  return (
    <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
        <p className="text-sm font-black text-red-600 dark:text-red-400">
          {drivers.length} active trip{drivers.length > 1 ? 's' : ''} with no live location
        </p>
      </div>
      <div className="space-y-1.5">
        {drivers.map((d) => (
          <Link
            key={d.driverId}
            href={`/dashboard/daily-sheets/${d.dailySheetId}`}
            className="flex items-center justify-between gap-3 rounded-xl bg-background/60 border border-red-500/20 px-3 py-2 text-xs hover:border-red-500/50 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <MapPinOff className="h-3.5 w-3.5 text-red-500 shrink-0" />
              <span className="font-bold truncate">{d.driverName}</span>
              {d.vanPlate && <span className="text-muted-foreground shrink-0">· {d.vanPlate}</span>}
            </div>
            <div className="flex items-center gap-1 text-muted-foreground shrink-0">
              <Clock className="h-3 w-3" />
              <span>trip started {timeAgo(d.tripStartedAt)}</span>
            </div>
          </Link>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Call these drivers directly — location may be off, permission denied, or the phone is unreachable.
      </p>
    </div>
  );
}
