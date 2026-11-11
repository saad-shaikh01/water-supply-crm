import { AsyncLocalStorage } from 'node:async_hooks';

export interface ImpersonationContext {
  sessionId: string;
  actorId: string;
  actorName: string;
}

/** Set by ImpersonationAuditInterceptor for the duration of an impersonated request; read by AuditService.log. */
export const impersonationContext = new AsyncLocalStorage<ImpersonationContext>();
