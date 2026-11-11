import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../auth/jwt.strategy';
import { AuditService } from '../audit/audit.service';
import { ImpersonationAuditInterceptor } from './impersonation-audit.interceptor';
import { impersonationContext } from './impersonation.context';
import { impersonationActiveKey } from './impersonation.service';
import { lastValueFrom, of } from 'rxjs';

function strategy(flags: Record<string, unknown>) {
  const cache = { get: jest.fn(async (k: string) => flags[k]) };
  return new JwtStrategy(cache as never);
}
const impPayload = { sub: 'u1', email: 'a@x', name: 'Admin', role: 'VENDOR_ADMIN', vendorId: 'v1', exp: 2_000_000_000, imp: { sid: 's1', actorId: 'sa1', actorName: 'Super', mode: 'READ_ONLY' } };

describe('JwtStrategy.validate with impersonation', () => {
  it('imp token without redis session (expired / revoked / flushed) -> 401', async () => {
    await expect(strategy({}).validate(impPayload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('active session -> user carries impersonation; tenant (vendorId) comes from the token', async () => {
    const u = await strategy({ [impersonationActiveKey('s1')]: true }).validate(impPayload);
    expect(u).toMatchObject({ userId: 'u1', vendorId: 'v1', role: 'VENDOR_ADMIN', impersonation: { sessionId: 's1', actorId: 'sa1', mode: 'READ_ONLY' } });
  });

  it('actor deactivated -> 401; suspended vendor -> 401', async () => {
    await expect(strategy({ [impersonationActiveKey('s1')]: true, 'user:sa1:inactive': true }).validate(impPayload)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy({ [impersonationActiveKey('s1')]: true, 'vendor:v1:suspended': true }).validate(impPayload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('regression: ordinary token unchanged and has no impersonation', async () => {
    const { imp, ...plain } = impPayload;
    const u = await strategy({}).validate(plain);
    expect(u.impersonation).toBeUndefined();
    expect(u.userId).toBe('u1');
  });
});

describe('audit enrichment', () => {
  it('AuditService.log merges changes.impersonatedBy inside an impersonation context only', async () => {
    const create = jest.fn(async () => ({}));
    const audit = new AuditService({ auditLog: { create } } as never);
    await audit.log({ action: 'CREATE', entity: 'Customer', changes: { after: { a: 1 } } });
    expect((create.mock.calls[0] as any)[0].data.changes).toEqual({ after: { a: 1 } });
    await impersonationContext.run({ sessionId: 's1', actorId: 'sa1', actorName: 'Super' }, () =>
      audit.log({ action: 'CREATE', entity: 'Customer', changes: { after: { a: 1 } } }),
    );
    expect((create.mock.calls[1] as any)[0].data.changes).toEqual({
      after: { a: 1 },
      impersonatedBy: { actorId: 'sa1', actorName: 'Super', sessionId: 's1' },
    });
  });

  it('interceptor exposes the context to the handler and records non-GET requests', async () => {
    const svc = { recordAction: jest.fn(async () => undefined) };
    const ic = new ImpersonationAuditInterceptor(svc as never);
    const mk = (method: string, imp?: object) =>
      ({ switchToHttp: () => ({ getRequest: () => ({ method, url: '/customers', user: { vendorId: 'v1', impersonation: imp } }), getResponse: () => ({ statusCode: 201 }) }) }) as never;
    const imp = { sessionId: 's1', actorId: 'sa1', actorName: 'Super', mode: 'SUPPORT' };
    let seen: unknown;
    const handler = { handle: () => { seen = impersonationContext.getStore(); return of('ok'); } };
    await lastValueFrom(ic.intercept(mk('POST', imp), handler as never));
    expect(seen).toMatchObject({ sessionId: 's1', actorId: 'sa1' });
    expect(svc.recordAction).toHaveBeenCalledWith(imp, 'v1', { method: 'POST', path: '/customers', status: 201 });
    await lastValueFrom(ic.intercept(mk('GET', imp), handler as never));
    expect(svc.recordAction).toHaveBeenCalledTimes(1);
    seen = 'untouched';
    await lastValueFrom(ic.intercept(mk('POST', undefined), handler as never));
    expect(seen).toBeUndefined();
  });
});
