import { Body, Controller, Get, Header, Param, Patch, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { Public } from '../../common/decorators/public.decorator';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MaintenanceExempt } from './maintenance-exempt.decorator';
import { PlatformSettingsService } from './platform-settings.service';
import { UpdateSettingDto } from './dto/platform-settings.dto';

@Controller('platform-settings')
@RequireSuperAdmin()
export class PlatformSettingsController {
  constructor(private readonly service: PlatformSettingsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Put(':key')
  async setOne(@Param('key') key: string, @Body() dto: UpdateSettingDto, @CurrentUser() actor: AuthUser) {
    await this.service.update({ [key]: dto.value }, actor);
    return { key, value: dto.value };
  }

  @Patch()
  patch(@Body() body: Record<string, unknown>, @CurrentUser() actor: AuthUser) {
    return this.service.update(body, actor);
  }
}

@Controller('platform')
export class PlatformStatusController {
  constructor(private readonly service: PlatformSettingsService) {}

  @Get('status')
  @Public()
  @MaintenanceExempt()
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 30 } })
  @Header('Cache-Control', 'no-store')
  status() {
    return this.service.publicStatus();
  }
}
