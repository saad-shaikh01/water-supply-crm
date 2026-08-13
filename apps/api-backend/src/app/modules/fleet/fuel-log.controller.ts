import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FuelLogService } from './fuel-log.service';
import { CreateFuelLogDto } from './dto/create-fuel-log.dto';
import { UpdateFuelLogDto } from './dto/update-fuel-log.dto';
import { FuelLogQueryDto } from './dto/fuel-log-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('fleet/fuel-logs')
export class FuelLogController {
  constructor(private readonly fuelLogService: FuelLogService) {}

  @Post()
  @RequirePermissions('fleet:record_fuel')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFuelLogDto) {
    return this.fuelLogService.create(user, dto);
  }

  @Get()
  @RequirePermissions('fleet:view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: FuelLogQueryDto) {
    return this.fuelLogService.findAll(user.vendorId, query);
  }

  @Get(':id')
  @RequirePermissions('fleet:view')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.fuelLogService.findOne(user.vendorId, id);
  }

  @Patch(':id')
  @RequirePermissions('fleet:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateFuelLogDto) {
    return this.fuelLogService.update(user.vendorId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('fleet:update')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.fuelLogService.remove(user.vendorId, id);
  }
}
