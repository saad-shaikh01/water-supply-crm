import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * NOTE: this only reads UNSIGNED cookie hints (`auth_token`, `user_role`). It is a
 * UX gate, not a security boundary. The real checks are AuthGate (GET /auth/me)
 * in the dashboard layout and the backend `@RequireSuperAdmin` guards.
 */
const SESSION_COOKIES = ['auth_token', 'refresh_token', 'user_role'];
const PUBLIC_AUTH_PATHS = ['/auth/reset-password', '/auth/forgot-password'];

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;
  const role = request.cookies.get('user_role')?.value;
  const { pathname } = request.nextUrl;

  const host =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    request.nextUrl.host;
  const proto =
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '');

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
      return NextResponse.next();
    }
    if (isAdmin) return redirectTo('/');
    // Stale / non-admin cookies: clear them and show the login page (no loop).
    const res = NextResponse.next();
    for (const c of SESSION_COOKIES) res.cookies.delete(c);
    return res;
  }

  // Authenticated but not a platform admin on a protected path
  if (token && !isAdmin) {
    return redirectTo('/auth/login?reason=forbidden', true);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
