import { allowsQueryToken, getJwtSecret, INSECURE_DEV_JWT_SECRET } from './jwt-secret';
import { JwtStrategy } from './jwt.strategy';

/** Audit M5 (no guessable signing secret in production) and L2 (`?token=` only for the SSE stream). */
describe('getJwtSecret', () => {
  it('production: refuses a missing secret', () => {
    expect(() => getJwtSecret({ NODE_ENV: 'production' } as never)).toThrow(/JWT_SECRET/);
    expect(() => getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: '' } as never)).toThrow(/JWT_SECRET/);
  });

  it('production: refuses the old hardcoded development default even when set explicitly', () => {
    expect(() => getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: INSECURE_DEV_JWT_SECRET } as never)).toThrow(
      /JWT_SECRET/,
    );
  });

  it('production: accepts a real secret', () => {
    expect(getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'a-long-random-production-secret' } as never)).toBe(
      'a-long-random-production-secret',
    );
  });

  it('development / test: keeps the dev fallback so local runs and tests still work', () => {
    expect(getJwtSecret({ NODE_ENV: 'development' } as never)).toBe(INSECURE_DEV_JWT_SECRET);
    expect(getJwtSecret({} as never)).toBe(INSECURE_DEV_JWT_SECRET);
    expect(getJwtSecret({ NODE_ENV: 'test', JWT_SECRET: 'custom' } as never)).toBe('custom');
  });
});

describe('query-string tokens', () => {
  it('are allowed only on the SSE tracking stream', () => {
    expect(allowsQueryToken('/api/tracking/subscribe')).toBe(true);
    expect(allowsQueryToken('/api/tracking/subscribe/')).toBe(true);
    expect(allowsQueryToken('/tracking/subscribe')).toBe(true);
  });

  it('are refused everywhere else', () => {
    for (const path of ['/api/users', '/api/portal/me', '/api/tracking/active', '/api/tracking/driver/x', '/api/tracking/subscribe/extra', undefined, '']) {
      expect(allowsQueryToken(path as never)).toBe(false);
    }
  });

  describe('JwtStrategy token extraction', () => {
    const strategy = new JwtStrategy({ get: jest.fn() } as never);
    const extract = (req: Record<string, unknown>) => (strategy as any)._jwtFromRequest(req);

    it('ignores ?token= on an ordinary route', () => {
      expect(extract({ headers: {}, query: { token: 'leaky-jwt' }, path: '/api/users' })).toBeNull();
    });

    it('uses ?token= on the SSE route', () => {
      expect(extract({ headers: {}, query: { token: 'sse-jwt' }, path: '/api/tracking/subscribe' })).toBe('sse-jwt');
    });

    it('always honours the Authorization header', () => {
      expect(extract({ headers: { authorization: 'Bearer hdr-jwt' }, query: {}, path: '/api/users' })).toBe('hdr-jwt');
    });
  });
});
