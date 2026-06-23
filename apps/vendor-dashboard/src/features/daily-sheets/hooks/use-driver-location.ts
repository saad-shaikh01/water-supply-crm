import { useState, useCallback } from 'react';

type Idle = { status: 'idle' };
type Loading = { status: 'loading' };
type Success = { status: 'success'; lat: number; lng: number };
type GeoError = { status: 'error'; message: string };

export type DriverLocationState = Idle | Loading | Success | GeoError;

export function useDriverLocation() {
  const [location, setLocation] = useState<DriverLocationState>({ status: 'idle' });

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocation({ status: 'error', message: 'Geolocation is not supported by this browser.' });
      return;
    }
    setLocation({ status: 'loading' });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        setLocation({ status: 'success', lat: coords.latitude, lng: coords.longitude }),
      (err) =>
        setLocation({ status: 'error', message: err.message }),
      { timeout: 10_000, maximumAge: 60_000, enableHighAccuracy: false },
    );
  }, []);

  return { location, requestLocation };
}
