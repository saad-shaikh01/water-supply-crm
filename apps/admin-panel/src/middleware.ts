import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;
  const { pathname } = request.nextUrl;

  const host =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    request.nextUrl.host;
  const proto =
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '');

  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, `${proto}://${host}`));

  // Protect all non-auth routes
  if (!token && !pathname.startsWith('/auth')) {
    return redirectTo('/auth/login');
  }

  // Redirect authenticated users away from auth pages
  if (token && pathname.startsWith('/auth')) {
    return redirectTo('/vendors');
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
