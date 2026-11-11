/** @jest-environment node */
import { NextRequest } from 'next/server';
import { buildCsp, middleware } from './middleware';
const { securityHeaders } = require('../security-headers');

const req = (path: string, cookies: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:4101${path}`, {
    headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
  });
const admin = { auth_token: 't', user_role: 'SUPER_ADMIN' };
const env = process.env as Record<string, string | undefined>;

describe('buildCsp', () => {
  it('has the nonce, strict-dynamic, frame-ancestors none, object-src none and the API origin in connect-src', () => {
    const csp = buildCsp('abc123', { dev: false, api: 'https://api.example.com' });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self' https://api.example.com");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("default-src 'self'");
  });

  it('dev additionally allows eval and websockets (HMR)', () => {
    const csp = buildCsp('n', { dev: true, api: 'http://localhost:3000' });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain('ws:');
  });
});

describe('middleware CSP header', () => {
  afterEach(() => delete env['CSP_REPORT_ONLY']);

  it('every non-redirect response carries a CSP with a fresh nonce per request', () => {
    const a = middleware(req('/vendors', admin)).headers.get('content-security-policy') ?? '';
    const b = middleware(req('/vendors', admin)).headers.get('content-security-policy') ?? '';
    const nonce = (s: string) => /'nonce-([^']+)'/.exec(s)?.[1];
    expect(nonce(a)).toBeTruthy();
    expect(nonce(a)).not.toBe(nonce(b));
    expect(a).toContain("frame-ancestors 'none'");
  });

  it('anonymous login page also gets the CSP', () => {
    expect(middleware(req('/auth/login')).headers.get('content-security-policy')).toContain("object-src 'none'");
  });

  it('CSP_REPORT_ONLY=true switches the header name', () => {
    env['CSP_REPORT_ONLY'] = 'true';
    const res = middleware(req('/vendors', admin));
    expect(res.headers.get('content-security-policy-report-only')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
});

describe('next.config security headers', () => {
  it('has the required static set', () => {
    const h = Object.fromEntries(securityHeaders(false).map((x: { key: string; value: string }) => [x.key, x.value]));
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Permissions-Policy']).toContain('camera=()');
    expect(h['Strict-Transport-Security']).toBeUndefined();
  });

  it('adds HSTS in production only', () => {
    const keys = securityHeaders(true).map((x: { key: string }) => x.key);
    expect(keys).toContain('Strict-Transport-Security');
  });
});
