'use client';

import { fcmApi } from '../api/fcm.api';

const FCM_TOKEN_STORAGE_KEY = 'customer-portal-fcm-token';
const FIREBASE_SCRIPT_ID = 'customer-portal-firebase-app';
const FIREBASE_MESSAGING_SCRIPT_ID = 'customer-portal-firebase-messaging';

declare global {
  interface Window {
    firebase?: {
      apps?: Array<{ name: string }>;
      initializeApp: (config: Record<string, string>) => unknown;
      app: () => unknown;
      messaging: () => {
        getToken: (options: { vapidKey: string; serviceWorkerRegistration: ServiceWorkerRegistration }) => Promise<string | null>;
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

let isFirebaseInitialized = false;

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

  // Only load scripts and initialize once
  if (!isFirebaseInitialized) {
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
    }
    isFirebaseInitialized = true;
  }

  const firebase = window.firebase;
  if (!firebase) return null;

  const registration = await ensureServiceWorker(config);
  const messaging = firebase.messaging();
  return messaging.getToken({
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration,
  });
}

export async function syncSessionFcmToken() {
  try {
    const nextToken = await requestBrowserFcmToken();
    if (!nextToken) return;

    const currentToken = getStoredToken();
    if (currentToken === nextToken) return;

    await fcmApi.registerToken(nextToken);

    if (currentToken) {
      await fcmApi.deleteToken(currentToken).catch(() => null);
    }

    setStoredToken(nextToken);
  } catch {
    // Auth/session flow should continue even if FCM setup fails.
  }
}

export async function unregisterSessionFcmToken() {
  const currentToken = getStoredToken();
  if (!currentToken) return;

  try {
    await fcmApi.deleteToken(currentToken);
  } catch {
    // Ignore cleanup failures; local state is still cleared to avoid repeated attempts on bad tokens.
  } finally {
    clearStoredToken();
  }
}

export function clearStoredSessionFcmToken() {
  clearStoredToken();
}
