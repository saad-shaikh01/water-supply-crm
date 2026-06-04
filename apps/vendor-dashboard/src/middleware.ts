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

  // DRIVER can only access allowed driver routes
  if (token && role === 'DRIVER' && pathname.startsWith('/dashboard')) {
    const driverAllowed = ['/dashboard/daily-sheets', '/dashboard/home', '/dashboard/history'];
    if (!driverAllowed.some((p) => pathname.startsWith(p))) {
      return redirectTo('/dashboard/home');
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/auth/:path*'],
};
