'use client';

import { useState, useEffect, useCallback } from 'react';
import { trackingApi, type DriverLocation } from '../api/tracking.api';
import { getCookie } from 'cookies-next';

export const useTracking = () => {
  const [drivers, setDrivers] = useState<Record<string, DriverLocation>>({});
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const token = getCookie('auth_token');
    if (!token) return;

    // Use absolute URL for EventSource if needed, or relative if proxied
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';
    
    // Note: Standard EventSource doesn't support headers. 
    // The backend implementation of /subscribe is expecting a JWT.
    // We can pass the token as a query param if the backend supports it, 
    // or use a polyfill like 'event-source-polyfill'.
    // For now, we'll try the standard way.
    
    const eventSource = new EventSource(`${API_URL}/tracking/subscribe?token=${token}`);

    eventSource.onopen = () => {
      setIsConnected(true);
      console.log('Tracking: SSE connection established');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as DriverLocation;
        setDrivers((prev) => ({
          ...prev,
          [data.driverId]: data,
        }));
      } catch (err) {
        console.error('Tracking: Failed to parse SSE message', err);
      }
    };

    eventSource.onerror = (err) => {
      setIsConnected(false);
      console.error('Tracking: SSE connection error', err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
      setIsConnected(false);
    };
  }, []);

  const driverList = Object.values(drivers);

  return {
    drivers,
    driverList,
    isConnected,
  };
};
