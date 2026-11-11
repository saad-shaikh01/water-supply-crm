/** @jest-environment node */
import { NextRequest } from 'next/server';
import { middleware, config } from './middleware';

const req = (path: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:4101${path}`, {
    headers: {
      cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
      ...headers,
    },
  });

const location = (res: Response) => res.headers.get('location');
const admin = { auth_token: 't', user_role: 'SUPER_ADMIN' };

describe('middleware', () => {
  it('anonymous on protected paths -> /auth/login', () => {
    expect(location(middleware(req('/')))).toBe('http://localhost:4101/auth/login');
    expect(location(middleware(req('/vendors')))).toBe('http://localhost:4101/auth/login');
  });

  it('anonymous on /auth/login passes; /auth/signup is just another auth path (404 by Next)', () => {
    expect(location(middleware(req('/auth/login')))).toBeNull();
  });

  it('removed signup: anonymous with no cookies on /auth/signup is allowed to reach Next (404), never a form', () => {
    const res = middleware(req('/auth/signup'));
    expect(res.status).toBe(200);
  });

  it('SUPER_ADMIN on /auth/login -> /', () => {
    expect(location(middleware(req('/auth/login', admin)))).toBe('http://localhost:4101/');
  });

  it('SUPER_ADMIN on protected path passes', () => {
    expect(location(middleware(req('/vendors', admin)))).toBeNull();
  });

  it('VENDOR_ADMIN cookie on protected path -> login forbidden with cookies cleared', () => {
    const res = middleware(req('/vendors', { auth_token: 't', user_role: 'VENDOR_ADMIN' }));
    expect(location(res)).toBe('http://localhost:4101/auth/login?reason=forbidden');
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toContain('auth_token=;');
    expect(set).toContain('user_role=;');
  });

  it('stale non-admin cookies on /auth/login: page shown, cookies cleared (no loop)', () => {
    const res = middleware(req('/auth/login', { auth_token: 't', user_role: 'DRIVER' }));
    expect(location(res)).toBeNull();
    expect(res.headers.get('set-cookie') ?? '').toContain('auth_token=;');
  });

  it('reset/forgot password stay reachable when authenticated', () => {
    expect(location(middleware(req('/auth/reset-password', admin)))).toBeNull();
    expect(location(middleware(req('/auth/forgot-password', admin)))).toBeNull();
  });

  it('respects x-forwarded-host/proto in redirect URL', () => {
    const res = middleware(req('/', {}, { 'x-forwarded-host': 'admin.example.com', 'x-forwarded-proto': 'https' }));
    expect(location(res)).toBe('https://admin.example.com/auth/login');
  });

  it('matcher excludes api and static assets', () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test('/vendors')).toBe(true);
    expect(re.test('/api/hello')).toBe(false);
    expect(re.test('/_next/static/x.js')).toBe(false);
  });
});
