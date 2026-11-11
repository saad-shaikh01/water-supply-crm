import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AllowInReadOnlyImpersonation, BlockWhenImpersonating } from './block-when-impersonating.decorator';
import { ImpersonationGuard } from './impersonation.guard';

class C {
  @BlockWhenImpersonating() blocked() { return 1; }
  normal() { return 1; }
  @AllowInReadOnlyImpersonation() exit() { return 1; }
}

const ctx = (method: string, handler: (...a: any[]) => any, imp?: { mode: 'READ_ONLY' | 'SUPPORT' }) =>
  ({
    getHandler: () => handler,
    getClass: () => C,
    switchToHttp: () => ({
      getRequest: () => ({ method, url: '/x', user: { vendorId: 'v1', ...(imp && { impersonation: { sessionId: 's', actorId: 'a', actorName: 'A', ...imp } }) } }),
    }),
  }) as unknown as ExecutionContext;

function setup() {
  const svc = { recordForbidden: jest.fn(async () => undefined) };
  return { guard: new ImpersonationGuard(new Reflector(), svc as never), svc };
}
const proto = C.prototype as any;

describe('ImpersonationGuard', () => {
  it('leaves normal tokens untouched (even on blocked routes and writes)', async () => {
    const { guard } = setup();
    await expect(guard.canActivate(ctx('POST', proto.blocked))).resolves.toBe(true);
    await expect(guard.canActivate(ctx('DELETE', proto.normal))).resolves.toBe(true);
  });

  it('READ_ONLY allows safe methods, blocks POST/PATCH/DELETE with IMPERSONATION_FORBIDDEN and audits', async () => {
    const { guard, svc } = setup();
    const imp = { mode: 'READ_ONLY' as const };
    await expect(guard.canActivate(ctx('GET', proto.normal, imp))).resolves.toBe(true);
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const err: any = await guard.canActivate(ctx(m, proto.normal, imp)).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'IMPERSONATION_FORBIDDEN' });
    }
    expect(svc.recordForbidden).toHaveBeenCalledTimes(4);
  });

  it('READ_ONLY still allows the exit route', async () => {
    await expect(setup().guard.canActivate(ctx('POST', proto.exit, { mode: 'READ_ONLY' }))).resolves.toBe(true);
  });

  it('SUPPORT allows writes on normal routes but @BlockWhenImpersonating is 403 in every mode', async () => {
    const { guard } = setup();
    await expect(guard.canActivate(ctx('POST', proto.normal, { mode: 'SUPPORT' }))).resolves.toBe(true);
    for (const mode of ['SUPPORT', 'READ_ONLY'] as const) {
      await expect(guard.canActivate(ctx('GET', proto.blocked, { mode }))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});
