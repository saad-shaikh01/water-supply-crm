import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { impersonationContext } from './impersonation.context';
import { ImpersonationService } from './impersonation.service';

/**
 * Global. For impersonated requests: runs the handler inside the AsyncLocalStorage context that
 * AuditService.log reads (so every audit row carries changes.impersonatedBy) and records every
 * non-GET request (IMPERSONATED_REQUEST + actionCount).
 */
@Injectable()
export class ImpersonationAuditInterceptor implements NestInterceptor {
  constructor(private readonly impersonation: ImpersonationService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const imp = req?.user?.impersonation;
    if (!imp) return next.handle();

    const method = String(req.method ?? '').toUpperCase();
    const store = { sessionId: imp.sessionId, actorId: imp.actorId, actorName: imp.actorName };
    const record = (status: number) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;
      void this.impersonation.recordAction(imp, req.user.vendorId, { method, path: req.originalUrl ?? req.url, status });
    };

    return new Observable((subscriber) =>
      impersonationContext.run(store, () =>
        next
          .handle()
          .pipe(
            tap({
              next: () => record(http.getResponse()?.statusCode ?? 200),
              error: (e) => record(typeof e?.getStatus === 'function' ? e.getStatus() : 500),
            }),
          )
          .subscribe(subscriber),
      ),
    );
  }
}
