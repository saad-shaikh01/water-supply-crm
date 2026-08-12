'use client';

import { useState, useCallback } from 'react';

export type LocationGateResult =
  | { ok: true }
  | { ok: false; reason: 'DENIED' | 'UNAVAILABLE' | 'UNSUPPORTED' };

/**
 * One-shot GPS check used to gate trip start. The live tracking map
 * (use-location-publisher.ts) only ever gets a driver's position if the
 * browser has already granted geolocation permission — this forces that
 * decision (and surfaces a clear blocker if it's denied) BEFORE the trip
 * begins, instead of letting a driver run an entire trip invisible to
 * dispatch with nothing but a silent console.warn.
 *
 * Deliberately skips navigator.permissions.query — support for the
 * 'geolocation' permission name is inconsistent on the older/cheap Android
 * WebViews field drivers commonly use. getCurrentPosition() itself triggers
 * the native prompt on first use and works everywhere geolocation does.
 */
export function useLocationGate() {
  const [checking, setChecking] = useState(false);

  const check = useCallback((): Promise<LocationGateResult> => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return Promise.resolve({ ok: false, reason: 'UNSUPPORTED' });
    }
    setChecking(true);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => {
          setChecking(false);
          resolve({ ok: true });
        },
        (err) => {
          setChecking(false);
          resolve({
            ok: false,
            reason: err.code === err.PERMISSION_DENIED ? 'DENIED' : 'UNAVAILABLE',
          });
        },
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 0 },
      );
    });
  }, []);

  return { check, checking };
}
