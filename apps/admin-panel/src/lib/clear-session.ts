import { deleteCookie } from 'cookies-next';
import { useAuthStore } from '../store/auth.store';

export const SESSION_COOKIES = ['auth_token', 'refresh_token', 'user_role'] as const;

/** Single place that wipes client auth state (logout, AuthGate, 401 handler). */
export function clearSession(): void {
  for (const name of SESSION_COOKIES) deleteCookie(name);
  useAuthStore.getState().clearUser();
}
