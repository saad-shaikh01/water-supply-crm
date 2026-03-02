'use client';

import { useEffect } from 'react';
import { useAuthStore } from '../../../store/auth.store';
import { syncSessionFcmToken, unregisterSessionFcmToken } from '../lib/fcm-session';

export function FcmTokenManager() {
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    if (!user?.id) return;

    let active = true;

    const syncToken = async () => {
      if (!active) return;
      await syncSessionFcmToken();
    };

    void syncToken();

    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    const handleSessionClear = () => {
      void unregisterSessionFcmToken();
    };

    window.addEventListener('customer-portal:session-cleared', handleSessionClear);
    return () => window.removeEventListener('customer-portal:session-cleared', handleSessionClear);
  }, []);

  return null;
}
