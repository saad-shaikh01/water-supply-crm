import { SetMetadata } from '@nestjs/common';

export const MAINTENANCE_EXEMPT_KEY = 'maintenance_exempt';

/** Route stays reachable while maintenance mode is ON (health, status, webhooks, sign-in). */
export const MaintenanceExempt = () => SetMetadata(MAINTENANCE_EXEMPT_KEY, true);

/**
 * Path allowlist (relative to the `/api` prefix, no query string) for routes that must never be blocked.
 * Verified against the real controllers:
 *  - health: `health` (HealthController, @Public)
 *  - sign-in/out: `auth/*` (login, refresh, logout, 2fa/*, forgot-password, reset-password) so admins can sign in
 *  - inbound provider callbacks: `webhooks/*` (Paymob transaction callback, WebhookController).
 *    There is NO inbound WhatsApp webhook controller in this codebase (WhatsApp is outbound only).
 *  - `platform/status` (also decorated)
 */
export const MAINTENANCE_EXEMPT_PREFIXES: readonly string[] = ['health', 'auth', 'webhooks', 'platform/status'];

export function isMaintenanceExemptPath(rawPath: string): boolean {
  let p = (rawPath || '').split('?')[0].replace(/^\/+/, '').replace(/\/+$/, '');
  if (p.startsWith('api/')) p = p.slice(4);
  else if (p === 'api') p = '';
  return MAINTENANCE_EXEMPT_PREFIXES.some((x) => p === x || p.startsWith(x + '/'));
}
