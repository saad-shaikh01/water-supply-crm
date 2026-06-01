import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;
  const role = request.cookies.get('user_role')?.value;
  const { pathname } = request.nextUrl;

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = '';
    return NextResponse.redirect(url);
  };

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
