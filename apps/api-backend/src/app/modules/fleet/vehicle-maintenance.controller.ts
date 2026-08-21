import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { VehicleMaintenanceService } from './vehicle-maintenance.service';
import { UpdateMaintenanceRuleDto } from './dto/update-maintenance-rule.dto';
import { CreateServiceRecordDto } from './dto/create-service-record.dto';
import { ServiceRecordQueryDto } from './dto/service-record-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('fleet/maintenance')
export class VehicleMaintenanceController {
  constructor(private readonly maintenanceService: VehicleMaintenanceService) {}

  // ── Static routes before parameterised ones ────────────────────────────────

  @Get('status')
  @RequirePermissions('fleet:view')
  getFleetWideStatus(@CurrentUser() user: AuthUser) {
    return this.maintenanceService.getFleetWideStatus(user.vendorId);
  }

  @Get('service-records')
  @RequirePermissions('fleet:view')
  listServiceRecords(@CurrentUser() user: AuthUser, @Query() query: ServiceRecordQueryDto) {
    return this.maintenanceService.listServiceRecords(user.vendorId, query);
  }

  @Post('service-records')
  @RequirePermissions('fleet:manage_maintenance')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  createServiceRecord(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceRecordDto) {
    return this.maintenanceService.createServiceRecord(user, dto);
  }

  @Get('service-records/:id')
  @RequirePermissions('fleet:view')
  getServiceRecord(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.maintenanceService.getServiceRecord(user.vendorId, id);
  }

  @Get('vehicles/:vehicleId/status')
  @RequirePermissions('fleet:view')
  getStatusForVehicle(@CurrentUser() user: AuthUser, @Param('vehicleId') vehicleId: string) {
    return this.maintenanceService.getStatusForVehicle(user.vendorId, vehicleId);
  }

  @Patch('rules/:id')
  @RequirePermissions('fleet:manage_maintenance')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  updateRule(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateMaintenanceRuleDto) {
    return this.maintenanceService.updateRule(user, id, dto);
  }
}
