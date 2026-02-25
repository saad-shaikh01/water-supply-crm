import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;
  const role = request.cookies.get('user_role')?.value;
  const { pathname } = request.nextUrl;

  // Protect dashboard routes — redirect to login if no token
  if (!token && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  // Redirect authenticated users away from auth pages
  if (token && pathname.startsWith('/auth')) {
    const dest = role === 'DRIVER' ? '/dashboard/home' : '/dashboard/overview';
    return NextResponse.redirect(new URL(dest, request.url));
  }

  // DRIVER can only access allowed driver routes
  if (token && role === 'DRIVER' && pathname.startsWith('/dashboard')) {
    const driverAllowed = ['/dashboard/daily-sheets', '/dashboard/home', '/dashboard/history'];
    if (!driverAllowed.some((p) => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL('/dashboard/home', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/auth/:path*'],
};
