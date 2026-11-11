import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * NOTE: this only reads UNSIGNED cookie hints (`auth_token`, `user_role`). It is a
 * UX gate, not a security boundary. The real checks are AuthGate (GET /auth/me)
 * in the dashboard layout and the backend `@RequireSuperAdmin` guards.
 *
 * It also sets a per-request nonce-based Content-Security-Policy (header name switches to
 * `Content-Security-Policy-Report-Only` when CSP_REPORT_ONLY=true).
 */
const SESSION_COOKIES = ['auth_token', 'refresh_token', 'user_role'];
const PUBLIC_AUTH_PATHS = ['/auth/reset-password', '/auth/forgot-password'];

function apiOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api').origin;
  } catch {
    return '';
  }
}

/** Build the CSP for one request. Exported for tests. */
export function buildCsp(nonce: string, { dev = process.env.NODE_ENV !== 'production', api = apiOrigin() } = {}): string {
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonced Next bootstrap load its own chunks; dev needs eval for React refresh.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Inline styles are required by Next/Radix/Framer; documented trade-off.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${api}${dev ? ' ws: wss:' : ''}`.trim(),
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  return directives.join('; ');
}

const cspHeaderName = () =>
  process.env.CSP_REPORT_ONLY === 'true' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';

function newNonce(): string {
  return btoa(crypto.randomUUID());
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;
  const role = request.cookies.get('user_role')?.value;
  const { pathname } = request.nextUrl;

  const nonce = newNonce();
  const csp = buildCsp(nonce);

  const host =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    request.nextUrl.host;
  const proto =
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '');

  /** Continue to Next with the nonce visible to the renderer (request headers) and the CSP on the response. */
  const next = () => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set(cspHeaderName(), csp);
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set(cspHeaderName(), csp);
    return res;
  };

  const redirectTo = (path: string, clearCookies = false) => {
    const res = NextResponse.redirect(new URL(path, `${proto}://${host}`));
    if (clearCookies) for (const c of SESSION_COOKIES) res.cookies.delete(c);
    return res;
  };

  const isAuthPath = pathname.startsWith('/auth');
  const isAdmin = role === 'SUPER_ADMIN';

  // Anonymous users may only see /auth/*
  if (!token && !isAuthPath) {
    return redirectTo('/auth/login');
  }

  if (token && isAuthPath) {
    if (PUBLIC_AUTH_PATHS.some((p) => pathname.startsWith(p))) {
      return next();
    }
    if (isAdmin) return redirectTo('/');
    // Stale / non-admin cookies: clear them and show the login page (no loop).
    const res = next();
    for (const c of SESSION_COOKIES) res.cookies.delete(c);
    return res;
  }

  // Authenticated but not a platform admin on a protected path
  if (token && !isAdmin) {
    return redirectTo('/auth/login?reason=forbidden', true);
  }

  return next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
