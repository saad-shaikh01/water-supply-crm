'use client';

import { useEffect, useRef } from 'react';
import { trackingApi } from '../../tracking/api/tracking.api';

/** Publish at most once every N ms regardless of movement */
const PUBLISH_INTERVAL_MS = 8_000;
/** Skip a publish if driver moved less than this since last successful publish */
const MIN_MOVEMENT_M = 15;
/** Publish an initial fix this long after watchPosition starts (cold-start grace) */
const FIRST_FIX_DELAY_MS = 2_000;

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
 * Active only when `enabled` is true (driver role + sheet open).
 *
 * Strategy:
 *  1. watchPosition streams continuous fixes into a ref (no re-renders).
 *  2. An interval fires every PUBLISH_INTERVAL_MS and pushes the latest fix
 *     only if the driver moved more than MIN_MOVEMENT_M since last publish.
 *  3. A one-shot timeout publishes the first available fix after FIRST_FIX_DELAY_MS
 *     so the driver appears on the map immediately on sheet open.
 */
export function useLocationPublisher(sheetId: string | null, enabled: boolean): void {
  const pendingPosRef = useRef<GeolocationPosition | null>(null);
  const lastPublishedRef = useRef<{ lat: number; lng: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firstFixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !sheetId) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;

    const attemptPublish = () => {
      const pos = pendingPosRef.current;
      if (!pos) return;

      const { latitude, longitude, speed, heading } = pos.coords;
      const last = lastPublishedRef.current;

      if (last && haversineM(last.lat, last.lng, latitude, longitude) < MIN_MOVEMENT_M) return;

      const snapshot = last;
      lastPublishedRef.current = { lat: latitude, lng: longitude };

      trackingApi
        .updateLocation({
          latitude,
          longitude,
          speed: speed ?? undefined,
          bearing: heading ?? undefined,
          status: 'DELIVERING',
        })
        .catch(() => {
          // Revert so we retry from the same position on next interval
          lastPublishedRef.current = snapshot;
        });
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        pendingPosRef.current = pos;
      },
      (err) => {
        console.warn('[LocationPublisher] GPS error:', err.message);
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );

    // Publish first fix quickly so the vendor sees the driver appear on map immediately
    firstFixTimerRef.current = setTimeout(attemptPublish, FIRST_FIX_DELAY_MS);

    intervalRef.current = setInterval(attemptPublish, PUBLISH_INTERVAL_MS);

    return () => {
      if (firstFixTimerRef.current !== null) {
        clearTimeout(firstFixTimerRef.current);
        firstFixTimerRef.current = null;
      }
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      pendingPosRef.current = null;
    };
  }, [enabled, sheetId]);
}
