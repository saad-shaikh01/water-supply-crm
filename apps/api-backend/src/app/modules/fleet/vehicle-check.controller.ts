import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { VehicleCheckService } from './vehicle-check.service';
import { CreateVehicleDailyCheckDto } from './dto/create-vehicle-daily-check.dto';
import { OverrideCriticalCheckDto } from './dto/override-critical-check.dto';
import { RequirePermissions, RequireAnyPermission } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('fleet/daily-checks')
export class VehicleCheckController {
  constructor(private readonly vehicleCheckService: VehicleCheckService) {}

  @Post()
  @RequirePermissions('fleet:record_check')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVehicleDailyCheckDto) {
    return this.vehicleCheckService.create(user, dto);
  }

  @Get('sheet/:dailySheetId')
  @RequireAnyPermission('fleet:record_check', 'fleet:view')
  getForSheet(@CurrentUser() user: AuthUser, @Param('dailySheetId') dailySheetId: string) {
    return this.vehicleCheckService.getForSheet(user, dailySheetId);
  }

  @Patch(':id/override-critical')
  @RequirePermissions('fleet:override_check')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 15 } })
  overrideCritical(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: OverrideCriticalCheckDto,
  ) {
    return this.vehicleCheckService.overrideCritical(user, id, dto);
  }
}
