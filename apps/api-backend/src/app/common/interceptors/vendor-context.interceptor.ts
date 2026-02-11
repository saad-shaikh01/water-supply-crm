import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class VendorContextInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user) {
      this.logger.assign({
        vendorId: user.vendorId,
        userId: user.userId,
        userRole: user.role,
      });
    }

    return next.handle();
  }
}
