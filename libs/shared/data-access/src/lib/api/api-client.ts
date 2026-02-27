import axios from 'axios';
import { getCookie, setCookie, deleteCookie } from 'cookies-next';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor — attach access token ──────────────────────────
apiClient.interceptors.request.use(
  (config) => {
    const token = getCookie('auth_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error),
);

// ── Refresh queue ──────────────────────────────────────────────────────
let isRefreshing = false;
type QueueEntry = { resolve: (token: string) => void; reject: (err: unknown) => void };
let failedQueue: QueueEntry[] = [];

const processQueue = (error: unknown, token: string | null) => {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
};

const clearAuth = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('customer-portal:session-cleared'));
  }
  deleteCookie('auth_token');
  deleteCookie('refresh_token');
  deleteCookie('user_role');
  if (typeof window !== 'undefined') window.location.href = '/auth/login';
};

// ── Response interceptor — silent token refresh on 401 ────────────────
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    // Skip: not 401, already retried, or it IS the refresh endpoint
    if (
      error.response?.status !== 401 ||
      original._retry ||
      original.url?.includes('/auth/refresh')
    ) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      // Queue and replay once refresh completes
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        return apiClient(original);
      });
    }

    original._retry = true;
    isRefreshing = true;

    const refreshToken = getCookie('refresh_token');
    if (!refreshToken) {
      isRefreshing = false;
      processQueue(error, null);
      clearAuth();
      return Promise.reject(error);
    }

    try {
      // Use plain axios — NOT apiClient — to avoid interceptor loop
      const { data } = await axios.post(`${API_URL}/auth/refresh`, {
        refreshToken,
      });

      setCookie('auth_token', data.access_token, { maxAge: 60 * 60 * 24 });       // 1 day
      setCookie('refresh_token', data.refresh_token, { maxAge: 60 * 60 * 24 * 7 }); // 7 days

      apiClient.defaults.headers.common.Authorization = `Bearer ${data.access_token}`;
      original.headers.Authorization = `Bearer ${data.access_token}`;

      processQueue(null, data.access_token);
      return apiClient(original);
    } catch (refreshError) {
      processQueue(refreshError, null);
      clearAuth();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);
