import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformAdminService } from './platform-admin.service';
import {
  CreatePlatformAdminDto,
  PlatformAdminQueryDto,
  ReasonDto,
  ResetPlatformAdminPasswordDto,
} from './dto/platform-admin.dto';

// Domain B — platform surface. Super-admin only.
@Controller('platform-admins')
@RequireSuperAdmin()
export class PlatformAdminController {
  constructor(private readonly service: PlatformAdminService) {}

  @Get()
  list(@Query() query: PlatformAdminQueryDto) {
    return this.service.list(query);
  }

  @Post()
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreatePlatformAdminDto) {
    return this.service.create(dto, actor);
  }

  @Patch(':id/deactivate')
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  deactivate(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.service.deactivate(id, dto.reason, actor);
  }

  @Patch(':id/activate')
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  activate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.service.activate(id, actor);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  resetPassword(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: ResetPlatformAdminPasswordDto) {
    return this.service.resetPassword(id, dto.mode, actor);
  }

  @Post(':id/reset-2fa')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  resetTwoFactor(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.service.resetTwoFactor(id, dto.reason, actor);
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 1000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  unlock(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.service.unlock(id, actor);
  }

  @Get(':id/sessions')
  listSessions(@Param('id') id: string) {
    return this.service.listSessions(id);
  }

  @Delete(':id/sessions/:sid')
  @HttpCode(HttpStatus.OK)
  revokeSession(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Param('sid') sid: string) {
    return this.service.revokeSession(id, sid, actor);
  }
}
