import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;
  const role = request.cookies.get('user_role')?.value;
  const { pathname } = request.nextUrl;

  // Next.js 15/16 builds request.nextUrl from the internal server address
  // (localhost:PORT), not from the Host header, when running behind a reverse
  // proxy. We explicitly read x-forwarded-host / host so the redirect URL
  // always uses the real public domain (vendor.testinglinq.com) rather than
  // the loopback address.
  const host =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    request.nextUrl.host;
  const proto =
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '');

  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, `${proto}://${host}`));

  // Protect dashboard routes — redirect to login if no token
  if (!token && pathname.startsWith('/dashboard')) {
    return redirectTo('/auth/login');
  }

  // Redirect authenticated users away from auth pages
  if (token && pathname.startsWith('/auth')) {
    return redirectTo(role === 'DRIVER' ? '/dashboard/home' : '/dashboard/overview');
  }

  // Per-route access is enforced by RouteGuard (client, via the live PAGE_REGISTRY + granted
  // permissions from `/auth/me`) and by each endpoint's backend RBAC guard — both read the
  // admin-configurable permission set. Middleware only has the `user_role` cookie, a static
  // snapshot that can't reflect per-role permission edits, so it must not gate by role here;
  // doing so previously hardcoded a DRIVER allowlist that silently overrode granted permissions
  // (e.g. Expenses access) with a redirect before RouteGuard ever ran.

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/auth/:path*'],
};
