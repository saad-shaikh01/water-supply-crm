import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  MiddlewareConsumer,
  Module,
  NestModule,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  LockOverrideMiddleware,
  applyLockOverrideMiddleware,
  getLockOverrideContext,
  parseLockOverrideHeader,
  runWithLockOverrideContext,
} from './lock-override.context';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe('parseLockOverrideHeader — percent-encoded values (dashboard sends encodeURIComponent)', () => {
  it('decodes Unicode reasons and falls back to the raw text for plain / malformed values', () => {
    const reason = 'غلط اندراج — ₨ 500 fix';
    expect(parseLockOverrideHeader(encodeURIComponent(reason))).toBe(reason);
    expect(parseLockOverrideHeader(encodeURIComponent('  spaced out reason  '))).toBe('spaced out reason');
    expect(parseLockOverrideHeader('plain ascii reason')).toBe('plain ascii reason');
    expect(parseLockOverrideHeader('50% of the total')).toBe('50% of the total');
    expect(parseLockOverrideHeader(encodeURIComponent('   '))).toBeNull();
  });
});

describe('parseLockOverrideHeader', () => {
  it('trims, and returns null for missing / blank / non-string', () => {
    expect(parseLockOverrideHeader('  fixing a typo from last month  ')).toBe('fixing a typo from last month');
    expect(parseLockOverrideHeader(undefined)).toBeNull();
    expect(parseLockOverrideHeader('   ')).toBeNull();
    expect(parseLockOverrideHeader(42)).toBeNull();
  });

  it('caps at 500 chars and takes the first of a repeated header', () => {
    expect(parseLockOverrideHeader('x'.repeat(900))).toHaveLength(500);
    expect(parseLockOverrideHeader(['first reason here', 'second'])).toBe('first reason here');
  });
});

describe('LockOverrideMiddleware', () => {
  const mw = new LockOverrideMiddleware();

  it('captures the header (case-insensitive key as Node lowercases it) and keeps the req', (done) => {
    const req = { headers: { 'x-lock-override-reason': ' Correcting August fuel ' } };
    mw.use(req, {}, () => {
      const ctx = getLockOverrideContext();
      expect(ctx?.overrideReason).toBe('Correcting August fuel');
      expect(ctx?.req).toBe(req);
      done();
    });
  });

  it('missing header -> overrideReason null (context still exists)', (done) => {
    mw.use({ headers: {} }, {}, () => {
      expect(getLockOverrideContext()).toBeDefined();
      expect(getLockOverrideContext()?.overrideReason).toBeNull();
      done();
    });
  });

  it('there is no context outside a request (scripts / jobs)', () => {
    expect(getLockOverrideContext()).toBeUndefined();
  });

  it('isolates two concurrent runs across awaits', async () => {
    const seen: Record<string, string | null | undefined> = {};
    const a = new Promise<void>((resolve) =>
      mw.use({ headers: { 'x-lock-override-reason': 'reason for request A' } }, {}, async () => {
        await tick();
        await tick();
        seen.a = getLockOverrideContext()?.overrideReason;
        resolve();
      }),
    );
    const b = new Promise<void>((resolve) =>
      mw.use({ headers: { 'x-lock-override-reason': 'reason for request B' } }, {}, async () => {
        await tick();
        seen.b = getLockOverrideContext()?.overrideReason;
        resolve();
      }),
    );
    await Promise.all([a, b]);
    expect(seen).toEqual({ a: 'reason for request A', b: 'reason for request B' });
    expect(getLockOverrideContext()).toBeUndefined();
  });

  it('runWithLockOverrideContext exposes the same store to helpers', () => {
    const value = runWithLockOverrideContext({ req: { user: { userId: 'u1' } }, overrideReason: 'a long enough reason' }, () =>
      getLockOverrideContext(),
    );
    expect(value?.req.user.userId).toBe('u1');
  });
});

// ── Real Nest wiring: wildcard route + lazy req.user set by a guard AFTER the middleware ──

@Injectable()
class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest().user = { userId: 'user-from-jwt' };
    return true;
  }
}

@Controller('probe')
@UseGuards(FakeJwtGuard)
class ProbeController {
  @Get()
  async probe() {
    await tick(); // cross an async boundary like a real service call would
    const ctx = getLockOverrideContext();
    return { reason: ctx?.overrideReason ?? null, userId: ctx?.req?.user?.userId ?? null };
  }
}

@Module({ controllers: [ProbeController], providers: [FakeJwtGuard] })
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    applyLockOverrideMiddleware(consumer);
  }
}

describe('LockOverrideMiddleware in a Nest app (real wildcard wiring)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api'); // same prefix as main.ts
    await app.listen(0);
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('header reaches a deep async read, and req.user (set by the guard later) is visible lazily', async () => {
    const res = await fetch(`${base}/api/probe`, { headers: { 'X-Lock-Override-Reason': 'closing-period correction' } });
    expect(await res.json()).toEqual({ reason: 'closing-period correction', userId: 'user-from-jwt' });
  });

  it('no header -> null reason, user still resolved', async () => {
    const res = await fetch(`${base}/api/probe`);
    expect(await res.json()).toEqual({ reason: null, userId: 'user-from-jwt' });
  });

  it('two concurrent HTTP requests never see each other\'s reason', async () => {
    const [a, b] = await Promise.all([
      fetch(`${base}/api/probe`, { headers: { 'X-Lock-Override-Reason': 'reason number one' } }).then((r) => r.json()),
      fetch(`${base}/api/probe`, { headers: { 'X-Lock-Override-Reason': 'reason number two' } }).then((r) => r.json()),
    ]);
    expect(a.reason).toBe('reason number one');
    expect(b.reason).toBe('reason number two');
  });
});
