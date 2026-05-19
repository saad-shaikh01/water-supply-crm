import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
