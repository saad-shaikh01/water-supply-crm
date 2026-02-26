import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

interface TokenPayload {
  role?: string;
  customerId?: string;
}

function decodeTokenPayload(token: string): TokenPayload | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as TokenPayload;
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;
  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith('/auth');
  const loginUrl = new URL('/auth/login', request.url);
  const homeUrl = new URL('/home', request.url);

  if (!token) {
    if (!isAuthRoute) {
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  const payload = decodeTokenPayload(token);
  const isCustomerToken = payload?.role === 'CUSTOMER' && !!payload.customerId;

  if (!isCustomerToken) {
    if (isAuthRoute) {
      const response = NextResponse.next();
      response.cookies.delete('auth_token');
      response.cookies.delete('refresh_token');
      return response;
    }
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete('auth_token');
    response.cookies.delete('refresh_token');
    return response;
  }

  // Redirect authenticated users away from auth pages
  if (isAuthRoute) {
    return NextResponse.redirect(homeUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
