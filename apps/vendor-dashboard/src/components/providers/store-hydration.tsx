'use client';

import { useEffect } from 'react';
import { useAuthStore } from '../../store/auth.store';

/**
 * Triggers zustand persist rehydration AFTER React hydration completes.
 * This prevents SSR/client mismatch caused by the store being populated
 * synchronously before React's first render.
 */
export function StoreHydration() {
  useEffect(() => {
    useAuthStore.persist.rehydrate();
  }, []);

  return null;
}
