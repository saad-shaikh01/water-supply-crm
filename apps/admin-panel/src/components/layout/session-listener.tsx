'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store/auth.store';

/**
 * The shared api-client dispatches this event when a refresh fails and the session
 * is terminal. We reset the admin-side stores (without editing the shared lib).
 */
export const SESSION_CLEARED_EVENT = 'customer-portal:session-cleared';

export function SessionListener() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handler = () => {
      useAuthStore.getState().clearUser();
      queryClient.clear();
    };
    window.addEventListener(SESSION_CLEARED_EVENT, handler);
    return () => window.removeEventListener(SESSION_CLEARED_EVENT, handler);
  }, [queryClient]);

  return null;
}
