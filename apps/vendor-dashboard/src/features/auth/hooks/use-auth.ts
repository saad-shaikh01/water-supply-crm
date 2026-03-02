import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setCookie, deleteCookie, getCookie } from 'cookies-next';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@water-supply-crm/data-access';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../../../store/auth.store';
import { queryKeys } from '../../../lib/query-keys';
import type { LoginInput } from '../schemas';
import type { Role } from '../../../lib/rbac';

const FCM_TOKEN_STORAGE_KEY = 'vendor-dashboard-fcm-token';
const FIREBASE_SCRIPT_ID = 'vendor-dashboard-firebase-app';
const FIREBASE_MESSAGING_SCRIPT_ID = 'vendor-dashboard-firebase-messaging';

declare global {
  interface Window {
    firebase?: {
      apps?: Array<{ name: string }>;
      initializeApp: (config: Record<string, string>) => unknown;
      app: () => unknown;
      messaging: () => {
        getToken: (options: {
          vapidKey: string;
          serviceWorkerRegistration: ServiceWorkerRegistration;
        }) => Promise<string | null>;
      };
    };
  }
}

type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
};

function getFirebaseConfig(): FirebaseWebConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const vapidKey =
    process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ??
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_VAPID_KEY;

  if (!apiKey || !authDomain || !projectId || !storageBucket || !messagingSenderId || !appId || !vapidKey) {
    return null;
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    vapidKey,
  };
}

function getStoredToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(FCM_TOKEN_STORAGE_KEY);
}

function setStoredToken(token: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(FCM_TOKEN_STORAGE_KEY, token);
}

function clearStoredToken() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(FCM_TOKEN_STORAGE_KEY);
}

function loadScript(src: string, id: string) {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Browser environment is required'));
  }

  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing) {
    return new Promise<void>((resolve, reject) => {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }

      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = id;
    script.async = true;
    script.src = src;
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = 'true';
        resolve();
      },
      { once: true }
    );
    script.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

async function loadFirebaseCompat() {
  await loadScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js', FIREBASE_SCRIPT_ID);
  await loadScript(
    'https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js',
    FIREBASE_MESSAGING_SCRIPT_ID
  );
}

async function ensureServiceWorker(config: FirebaseWebConfig) {
  const params = new URLSearchParams({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  });

  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${params.toString()}`);
}

async function requestBrowserFcmToken() {
  if (typeof window === 'undefined') return null;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return null;

  const config = getFirebaseConfig();
  if (!config) return null;

  let permission = window.Notification.permission;
  if (permission === 'default') {
    permission = await window.Notification.requestPermission();
  }

  if (permission !== 'granted') return null;

  await loadFirebaseCompat();

  const firebase = window.firebase;
  if (!firebase) return null;

  if (!firebase.apps?.length) {
    firebase.initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
    });
  } else {
    firebase.app();
  }

  const registration = await ensureServiceWorker(config);
  const messaging = firebase.messaging();
  return messaging.getToken({
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration,
  });
}

export async function syncVendorSessionFcmToken() {
  try {
    const nextToken = await requestBrowserFcmToken();
    if (!nextToken) return;

    const currentToken = getStoredToken();
    await apiClient.post('/fcm/token', { token: nextToken, platform: 'web' });

    if (currentToken && currentToken !== nextToken) {
      await apiClient.delete('/fcm/token', { data: { token: currentToken } }).catch(() => null);
    }

    setStoredToken(nextToken);
  } catch {
    // Auth/session flow should continue even if FCM setup fails.
  }
}

export async function unregisterVendorSessionFcmToken() {
  const currentToken = getStoredToken();
  if (!currentToken) return;

  try {
    await apiClient.delete('/fcm/token', { data: { token: currentToken } });
  } catch {
    // Ignore cleanup failures; local token is still cleared to avoid repeated bad requests.
  } finally {
    clearStoredToken();
  }
}

export const useLogin = () => {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: LoginInput) => authApi.login(data),
    onSuccess: ({ data }) => {
      setCookie('auth_token', data.access_token, { maxAge: 60 * 60 * 24 });       // 1 day
      setCookie('refresh_token', data.refresh_token, { maxAge: 60 * 60 * 24 * 7 }); // 7 days
      setCookie('user_role', data.user.role, { maxAge: 60 * 60 * 24 * 7 });
      setUser({ ...data.user, role: data.user.role as Role });
      queryClient.setQueryData(queryKeys.auth.me, data.user);
      if (data.user.role === 'DRIVER') {
        router.push('/dashboard/home');
      } else {
        router.push('/dashboard/overview');
      }
    },
    onError: () => {
      toast.error('Invalid email or password');
    },
  });
};

export const useLogout = () => {
  const router = useRouter();
  const clearUser = useAuthStore((s) => s.clearUser);
  const queryClient = useQueryClient();

  return async () => {
    const refreshToken = getCookie('refresh_token') as string | undefined;
    await unregisterVendorSessionFcmToken().catch(() => null);
    // Fire-and-forget: invalidate refresh token in Redis
    if (refreshToken) {
      authApi.logout(refreshToken).catch(() => null);
    }
    deleteCookie('auth_token');
    deleteCookie('refresh_token');
    deleteCookie('user_role');
    clearUser();
    queryClient.clear();
    router.push('/auth/login');
  };
};

export const useForgotPassword = () => {
  return useMutation({
    mutationFn: (email: string) => authApi.forgotPassword(email),
    onSuccess: () => {
      toast.success('Password reset email sent. Check your inbox.');
    },
    onError: () => {
      toast.error('Failed to send reset email. Please try again.');
    },
  });
};

export const useResetPassword = () => {
  const router = useRouter();

  return useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      authApi.resetPassword(token, password),
    onSuccess: () => {
      toast.success('Password reset successfully!');
      router.push('/auth/login');
    },
    onError: () => {
      toast.error('Failed to reset password. Token may be expired.');
    },
  });
};
