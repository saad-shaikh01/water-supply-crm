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
    // Await rehydration before flipping `isHydrated` — otherwise consumers could see
    // `isHydrated: true` for a render or two while `user` is still `null`.
    Promise.resolve(useAuthStore.persist.rehydrate()).then(() => {
      useAuthStore.getState().setHydrated(true);
    });
  }, []);

  return null;
}
