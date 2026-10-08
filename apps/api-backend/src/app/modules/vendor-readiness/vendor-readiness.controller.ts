import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsOptional } from 'class-validator';
import type { AuthUser } from '@water-supply-crm/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { VendorReadinessService } from './vendor-readiness.service';

export class GoLiveDto {
  /** Platform admin only: go live even though required items are open. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/** The signed-in vendor's own onboarding checklist. */
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly readiness: VendorReadinessService) {}

  @Get('readiness')
  @RequirePermissions('company_profile:view')
  get(@CurrentUser() user: AuthUser) {
    return this.readiness.get(user.vendorId);
  }

  @Post('go-live')
  @RequirePermissions('company_profile:update')
  @Throttle({ short: { ttl: 2000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  goLive(@CurrentUser() user: AuthUser) {
    return this.readiness.goLive(user.vendorId, user);
  }
}

/** Platform surface. */
@Controller()
@RequireSuperAdmin()
export class PlatformOnboardingController {
  constructor(private readonly readiness: VendorReadinessService) {}

  @Get('platform/onboarding')
  overview() {
    return this.readiness.overview();
  }

  @Get('vendors/:vendorId/readiness')
  get(@Param('vendorId') vendorId: string) {
    return this.readiness.get(vendorId);
  }

  @Post('vendors/:vendorId/go-live')
  @Throttle({ short: { ttl: 2000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  goLive(@CurrentUser() user: AuthUser, @Param('vendorId') vendorId: string, @Body() dto: GoLiveDto) {
    return this.readiness.goLive(vendorId, user, { force: dto.force });
  }

  @Post('vendors/:vendorId/go-offline')
  goOffline(@CurrentUser() user: AuthUser, @Param('vendorId') vendorId: string) {
    return this.readiness.goOffline(vendorId, user);
  }
}
