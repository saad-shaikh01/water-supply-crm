import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { Public } from '../../common/decorators/public.decorator';
import { AuthenticatedOnly, RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowInReadOnlyImpersonation, BlockWhenImpersonating } from './block-when-impersonating.decorator';
import { ExchangeImpersonationDto, ListImpersonationQueryDto, StartImpersonationDto } from './dto/impersonation.dto';
import { ImpersonationService } from './impersonation.service';

const meta = (req: any) => ({ ip: req?.ip, userAgent: req?.headers?.['user-agent'] });

@Controller('platform/impersonation')
@RequireSuperAdmin()
@BlockWhenImpersonating()
export class PlatformImpersonationController {
  constructor(private readonly service: ImpersonationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 5 } })
  start(@CurrentUser() user: AuthUser, @Body() dto: StartImpersonationDto, @Req() req: any) {
    return this.service.start(user, dto, meta(req));
  }

  @Get()
  list(@Query() query: ListImpersonationQueryDto) {
    return this.service.list(query);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.end(id, 'REVOKED', { userId: user.userId, name: user.name });
  }
}

@Controller('auth/impersonation')
export class AuthImpersonationController {
  constructor(private readonly service: ImpersonationService) {}

  @Post('exchange')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  exchange(@Body() dto: ExchangeImpersonationDto, @Req() req: any) {
    return this.service.exchange(dto.code, meta(req));
  }

  @Post('exit')
  @AuthenticatedOnly()
  @AllowInReadOnlyImpersonation()
  @HttpCode(HttpStatus.OK)
  async exit(@CurrentUser() user: AuthUser) {
    if (!user.impersonation) throw new ForbiddenException('Not an impersonation session.');
    await this.service.end(user.impersonation.sessionId, 'EXIT', {
      userId: user.impersonation.actorId,
      name: user.impersonation.actorName,
    });
    return { ok: true };
  }
}
