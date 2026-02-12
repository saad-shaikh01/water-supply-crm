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
    const dest = role === 'DRIVER' ? '/dashboard/daily-sheets' : '/dashboard/overview';
    return NextResponse.redirect(new URL(dest, request.url));
  }

  // DRIVER can only access /dashboard/daily-sheets/*
  if (token && role === 'DRIVER' && pathname.startsWith('/dashboard')) {
    if (!pathname.startsWith('/dashboard/daily-sheets')) {
      return NextResponse.redirect(new URL('/dashboard/daily-sheets', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/auth/:path*'],
};
