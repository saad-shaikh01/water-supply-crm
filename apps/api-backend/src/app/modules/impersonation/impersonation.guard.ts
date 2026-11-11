import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_IN_READ_ONLY_KEY, BLOCK_WHEN_IMPERSONATING_KEY } from './block-when-impersonating.decorator';
import { ImpersonationService } from './impersonation.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard registered AFTER PermissionsGuard. No-op for ordinary tokens. Under an impersonation
 * token: READ_ONLY sessions may only use safe methods, and @BlockWhenImpersonating() routes are
 * refused in every mode.
 */
@Injectable()
export class ImpersonationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly impersonation: ImpersonationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const imp = req?.user?.impersonation;
    if (!imp) return true;

    const targets = [context.getHandler(), context.getClass()];
    const method = String(req.method ?? '').toUpperCase();
    const blocked = this.reflector.getAllAndOverride<boolean>(BLOCK_WHEN_IMPERSONATING_KEY, targets);
    const allowedRO = this.reflector.getAllAndOverride<boolean>(ALLOW_IN_READ_ONLY_KEY, targets);

    let deny: string | null = null;
    if (blocked) deny = 'This action is not allowed during a support (impersonation) session.';
    else if (imp.mode === 'READ_ONLY' && !SAFE_METHODS.has(method) && !allowedRO) {
      deny = 'This support session is read-only.';
    }
    if (!deny) return true;

    await this.impersonation
      .recordForbidden(imp, req.user.vendorId, { method, path: req.originalUrl ?? req.url, mode: imp.mode })
      .catch(() => undefined);
    throw new ForbiddenException({ statusCode: 403, code: 'IMPERSONATION_FORBIDDEN', message: deny });
  }
}
