'use client';

import { useState, useEffect, useRef } from 'react';
import { trackingApi, type DriverLocation } from '../api/tracking.api';
import { getCookie } from 'cookies-next';

/** Maximum number of reconnect attempts before giving up */
const MAX_RETRIES = 5;
/** Initial reconnect delay in ms — doubles on each failure, capped at 60 s */
const BASE_DELAY_MS = 3_000;

export const useTracking = () => {
  const [drivers, setDrivers] = useState<Record<string, DriverLocation>>({});
  const [isConnected, setIsConnected] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [lastEventTime, setLastEventTime] = useState<Date | null>(null);

  // Refs keep the reconnect state stable across re-renders without causing them.
  const esRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    // The JWT strategy already supports ?token= extraction (query-param path
    // is required because the standard EventSource API has no header support).
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

    /** Merge one location event into state; 'offline' sentinel removes the driver. */
    const applyUpdate = (data: DriverLocation) => {
      setLastEventTime(new Date());
      if (data.status === 'offline') {
        setDrivers((prev) => {
          const next = { ...prev };
          delete next[data.driverId];
          return next;
        });
      } else {
        setDrivers((prev) => ({ ...prev, [data.driverId]: data }));
      }
    };

    /** Open an SSE connection; schedules a backoff retry on failure. */
    const connect = () => {
      if (cancelledRef.current) return;

      const token = getCookie('auth_token');
      if (!token) return;

      // Clean up any previous instance before creating a new one.
      esRef.current?.close();

      const es = new EventSource(`${API_URL}/tracking/subscribe?token=${token}`);
      esRef.current = es;

      es.onopen = () => {
        if (cancelledRef.current) { es.close(); return; }
        setIsConnected(true);
        retryCountRef.current = 0; // reset backoff counter on successful connect
        setRetryCount(0);
      };

      es.onmessage = (event) => {
        if (cancelledRef.current) return;
        try {
          applyUpdate(JSON.parse(event.data) as DriverLocation);
        } catch (err) {
          console.error('Tracking: failed to parse SSE message', err);
        }
      };

      es.onerror = () => {
        if (cancelledRef.current) { es.close(); return; }
        setIsConnected(false);
        es.close();
        esRef.current = null;

        if (retryCountRef.current >= MAX_RETRIES) {
          console.warn('Tracking: max SSE reconnect attempts reached — page reload required');
          return;
        }

        // Exponential backoff: 3 s → 6 s → 12 s → 24 s → 48 s → capped at 60 s
        const delay = Math.min(BASE_DELAY_MS * 2 ** retryCountRef.current, 60_000);
        retryCountRef.current += 1;
        setRetryCount(retryCountRef.current);
        retryTimeoutRef.current = setTimeout(connect, delay);
      };
    };

    // ── Step 1: hydrate state from REST snapshot for an instant first render ──
    // The SSE connection also sends a snapshot on open (server-side), but the
    // HTTP snapshot arrives faster and decouples initial render from SSE setup.
    trackingApi
      .getActiveDrivers()
      .then(({ data }) => {
        if (cancelledRef.current) return;
        const initial: Record<string, DriverLocation> = {};
        for (const driver of data) {
          initial[driver.driverId] = driver;
        }
        setDrivers(initial);
      })
      .catch(() => {
        // Non-fatal — SSE will still populate state on connect
      });

    // ── Step 2: open SSE stream; live events layer on top of the snapshot ────
    connect();

    return () => {
      cancelledRef.current = true;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      esRef.current?.close();
      esRef.current = null;
      setIsConnected(false);
    };
  }, []);

  return {
    drivers,
    driverList: Object.values(drivers),
    isConnected,
    retryCount,
    lastEventTime,
  };
};
