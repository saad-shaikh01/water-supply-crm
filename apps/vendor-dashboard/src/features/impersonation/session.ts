import { deleteCookie, getCookie, setCookie } from 'cookies-next';

/** Marker cookie (session-scoped, no maxAge) telling middleware/UI this tab holds a support session. */
export const IMPERSONATING_COOKIE = 'impersonating';

export function isImpersonating(): boolean {
  return getCookie(IMPERSONATING_COOKIE) === '1';
}

/** Session cookies only (no maxAge): they die with the browser session. No refresh token is ever stored. */
export function startImpersonationCookies(accessToken: string, role: string): void {
  deleteCookie('refresh_token');
  setCookie('auth_token', accessToken);
  setCookie('user_role', role);
  setCookie(IMPERSONATING_COOKIE, '1');
}

export function clearAuthCookies(): void {
  deleteCookie('auth_token');
  deleteCookie('refresh_token');
  deleteCookie('user_role');
}

export function clearImpersonationMarker(): void {
  deleteCookie(IMPERSONATING_COOKIE);
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Hard navigation (kept here so tests can mock it). */
export function navigateTo(path: string): void {
  window.location.assign(path);
}
