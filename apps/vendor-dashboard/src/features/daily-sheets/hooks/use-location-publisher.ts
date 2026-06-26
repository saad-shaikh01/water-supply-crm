'use client';

import { useEffect, useRef } from 'react';
import { trackingApi } from '../../tracking/api/tracking.api';

/** Publish when driver moves at least this many metres */
const MIN_MOVEMENT_M = 10;
/**
 * Force-publish every N ms even when stationary.
 * Keeps the Redis key alive (backend TTL = 5 min = 300 s) so the driver never
 * disappears from the vendor map while parked at a customer's location.
 */
const HEARTBEAT_MS = 45_000;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Continuously publishes the driver's GPS location to the tracking backend.
 * Only active when `enabled` is true (driver role + open sheet).
 *
 * Strategy:
 *  1. watchPosition fires event-driven when GPS has a new fix.
 *     - First fix: publish immediately — driver appears on vendor map within seconds.
 *     - Subsequent fixes: publish only if driver moved >= MIN_MOVEMENT_M.
 *  2. A heartbeat interval fires every HEARTBEAT_MS and force-publishes the current
 *     position regardless of movement, preventing the Redis TTL from expiring when
 *     the driver is stationary at a customer's location.
 */
export function useLocationPublisher(sheetId: string | null, enabled: boolean): void {
  const pendingPosRef = useRef<GeolocationPosition | null>(null);

  useEffect(() => {
    if (!enabled || !sheetId) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;

    // Closure-local — reset on every effect run, no stale-ref cross-contamination.
    let lastPublished: { lat: number; lng: number; time: number } | null = null;
    let heartbeatId: ReturnType<typeof setInterval> | null = null;

    const doPublish = (pos: GeolocationPosition) => {
      const { latitude, longitude, speed, heading } = pos.coords;
      const snapshot = lastPublished;
      lastPublished = { lat: latitude, lng: longitude, time: Date.now() };

      trackingApi
        .updateLocation({
          latitude,
          longitude,
          speed: speed ?? undefined,
          bearing: heading ?? undefined,
          status: 'DELIVERING',
        })
        .catch(() => {
          // Revert so the next heartbeat retries from the same position.
          lastPublished = snapshot;
        });
    };

    // ── Event-driven publishing ──────────────────────────────────────────────
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        pendingPosRef.current = pos;
        const { latitude, longitude } = pos.coords;

        // First GPS fix → publish immediately so driver appears on map right away.
        if (!lastPublished) {
          doPublish(pos);
          return;
        }

        // Subsequent fixes: only publish if the driver actually moved enough.
        const moved = haversineM(lastPublished.lat, lastPublished.lng, latitude, longitude);
        if (moved >= MIN_MOVEMENT_M) {
          doPublish(pos);
        }
      },
      (err) => {
        console.warn('[LocationPublisher] GPS error:', err.message);
      },
      { enableHighAccuracy: true, maximumAge: 2_000, timeout: 10_000 },
    );

    // ── Heartbeat: keep Redis key alive for stationary drivers ───────────────
    heartbeatId = setInterval(() => {
      const pos = pendingPosRef.current;
      if (!pos || !lastPublished) return;
      // Guard: skip if a movement-triggered publish just happened.
      if (Date.now() - lastPublished.time >= HEARTBEAT_MS) {
        doPublish(pos);
      }
    }, HEARTBEAT_MS);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (heartbeatId !== null) clearInterval(heartbeatId);
      pendingPosRef.current = null;
    };
  }, [enabled, sheetId]);
}
